import { parse } from "https://unpkg.com/abnf@3.0.1/lib/abnfp.js";
import serialize, { wrapper} from "https://dontcallmedom.github.io/rfcref/abnf/tools/lib/serialize.mjs";

import html from "https://unpkg.com/escape-html-template-tag@2.2.3/dist/index.module.mjs";

import rr, {defaultCSS} from "https://tabatkins.github.io/railroad-diagrams/railroad.js";

const  abnfIndex = await (await fetch("https://dontcallmedom.github.io/rfcref/abnf/index.json")).json(); ;

const enc = new TextEncoder();

window.Buffer = {
  from: str => enc.encode(" ")
};

const output = document.getElementById("output");
const source = document.getElementById("source");

const numSelector = document.getElementById("num");
for (const rfc of abnfIndex) {
  const opt = document.createElement("option");
  opt.value = rfc.name.slice(3);
  opt.textContent = rfc.name;
  numSelector.append(opt);
}

function nameIsFrom(name, rfcData, dep) {
  const imported = Object.keys(rfcData.dependencies).find(k => rfcData.dependencies[k].names.includes(name.toUpperCase()));
  const extended = Object.keys(dep.extends || {}).map(n => n.toUpperCase()).includes(name.toUpperCase());
  if (extended) return {extended};
  if (imported) return {imported};
  return {};
}

const classSpanWrap = (rfc, dep) => new Proxy(wrapper(), {
  get(target, name) {
    if (name === "rulenamedecl") {
      return function(i) {
	let comment = "";
	let linkStart = "", linkEnd = "";
	const {extended, imported} = nameIsFrom(i, rfc, dep);
	if (extended) {
	  comment = html`<span class='comment'>; Extends definition in <a href="?num=${extended.slice(3)}">${extended}</a></span>\n`;
	  linkStart = html`<a href="?num=${extended.slice(3)}#${i}">`;
	  linkEnd = html`</a>`;
	} else if (imported) {
	  comment = html`<span class='comment'>; Imported from <a href="?num=${imported.slice(3)}">${imported}</a></span>\n`;
	  linkStart = html`<a href="?num=${imported.slice(3)}#${i}">`;
	  linkEnd = html`</a>`;
	}
	return comment + html`<dfn id="${i}">` + linkStart + i + linkEnd + html`</dfn>`;
      };
    } else if (name === "rulename") {
      return i => html`<a href="#${i}">` + i + html`</a>`;
    }
    return i => html`<span class='${name}'>` + target[name](i) + html`</span>`;
  }
});

const urlParams = new URLSearchParams(location.search);
const num =  urlParams.get("num");
if (num && num.match(/^[0-9]+/)) {
  document.getElementById("num").value = num;
  await showRfcAbnf(num);
}

function abnfToRailroad(rule, topRules = []) {
  const base = {2: "b", 10: "d", 16: "x"}[rule.base];
  switch(rule.type) {
  case "rule":
    if (topRules.includes(rule.name.toUpperCase())) {
      return rr.ComplexDiagram(rr.Comment(rule.name), abnfToRailroad(rule.def));
    } else {
      return rr.Diagram(rr.Comment(rule.name), abnfToRailroad(rule.def));
    }
  case "caseSensitveString":
    if (rule.base) {
      return rr.Terminal(`%${base}${Buffer.from(rule.str)[0].toString(rule.base)}`);
    } else {
      return rr.Terminal(`"${rule.str}")}`);
    }
  case "caseInsensitveString":
    if (rule.base) {
      return rr.Terminal(`%${base}${parseInt(rule.str, rule.base)}`);
    } else {
      return rr.Terminal(`"${rule.str}"`);
    }
  case "alternation":
    return rr.Choice(0, ...rule.alts.map(abnfToRailroad));
  case "ruleref":
    return rr.NonTerminal(rule.name, { href: "#" + rule.name });
  case "concatenation":
    return rr.Sequence(...rule.elements.map(abnfToRailroad));
  case "group":
    return rr.Group(abnfToRailroad(rule.alt));
  case "range":
    return rr.Terminal(`%${base}${rule.first.toString(rule.base)}-${rule.last.toString(rule.base)}`);
  case "prose":
    return rr.Terminal(`<${rule.str}>`);
  case "repetition":
    if (rule.rep.min === 0 && rule.rep.max === 1) {
      return rr.Optional(abnfToRailroad(rule.el));
    }
    const repetitorComment = rr.Comment(`${rule.rep.min}${rule.rep.max !== rule.rep.min ? `-${rule.rep.max ?? "∞"}` : ""}`);
    // TODO: indicate max repeat somewhere?
    if (rule.rep.min === 0) {
      return rr.ZeroOrMore(abnfToRailroad(rule.el), repetitorComment);
    }
    return rr.OneOrMore(abnfToRailroad(rule.el), repetitorComment);
  default:
    throw new Error(`Unexpected type ${rule.type} from ABNF rule: ${rule}`);
  }

}


async function showRfcAbnf(num) {
  const rrStyle = document.createElement("style");
  rrStyle.textContent = defaultCSS;
  document.querySelector("head").append(rrStyle);
  const abnfUrl = `https://dontcallmedom.github.io/rfcref/abnf/consolidated/rfc${num}.abnf`;
  const abnfRes = await fetch(abnfUrl);
  if (abnfRes.status === 404) {
    document.getElementById("title").remove();
    output.textContent = `No consolidated ABNF found for RFC ${num}.`;
    source.innerHTML = "";
    return;
  }
  const rfc = abnfIndex.find(e => e.name === `RFC${num}`);
  const title = document.getElementById("title") ?? document.createElement("h2");
  if (!title.id) {
    title.id = "title";
    
    source.insertAdjacentElement('beforebegin', title);
  }
  title.innerHTML = html`<a href="https://datatracker.ietf.org/doc/html/rfc${num}">${rfc.title}</a>`;
  const sourceLink = document.createElement("a");
  sourceLink.textContent = "source ABNF in rfcref";
  sourceLink.href = abnfUrl;
  source.append(sourceLink);
  const abnf = await abnfRes.text();
  let dependencies = {};
  try {
    dependencies = await (await fetch(`https://dontcallmedom.github.io/rfcref/abnf/dependencies/rfc${num}.json`)).json();
  } catch (e) {

  }
  const rules = parse(abnf);
  const unreferencedDefs = Object.keys(rules.defs).filter(d => !rules.refs.find(r => r.name.toUpperCase() === d));
  let h = "";
  const w = classSpanWrap(rfc, dependencies);
  for (const def of Object.values(rules.defs)) {
    h += serialize(def, w) + "\n\n";
    const {extended, imported} = nameIsFrom(def.name, rfc, dependencies);
    if (!extended && !imported) {
      h += abnfToRailroad(def, unreferencedDefs).toString();
    }
  }
  output.innerHTML = h;
  if (location.hash) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView(true);
  }
}
