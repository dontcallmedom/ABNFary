import { parse } from "https://unpkg.com/abnf@3.0.1/lib/abnfp.js";
import serialize, { wrapper} from "https://dontcallmedom.github.io/rfcref/abnf/tools/lib/serialize.mjs";

import html from "https://unpkg.com/escape-html-template-tag@2.2.3/dist/index.module.mjs";

import rr, {defaultCSS} from "https://tabatkins.github.io/railroad-diagrams/railroad.js";


const enc = new TextEncoder();

window.Buffer = {
  from: str => enc.encode(" ")
};

const output =   document.getElementById("output");

const classSpanWrap = dep => new Proxy(wrapper(), {
  get(target, name) {
    if (name === "rulenamedecl") {
      return function(i) {
	let comment = "";
	if (Object.keys(dep.imports || {}).includes(i)) {
	  comment = html`<span class='comment'>; Imported from <a href="?${dep.imports[i].slice(3)}">${dep.imports[i]}</a></span>\n`;
	}
	return comment + html`<dfn id="${i}">` + i + html`</dfn>`;
      };
    } else if (name === "rulename") {
      return i => html`<a href="#${i}">` + i + html`</a>`;
    }
    return i => html`<span class='${name}'>` + target[name](i) + html`</span>`;
  }
});


const num =  window.location.search.slice(1);
if (num && num.match(/^[0-9]+/)) {
  await showRfcAbnf(num);
}

function abnfToRailroad(rule, topRules = []) {
  const base = {2: "b", 10: "d", 16: "x"}[rule.base];
  switch(rule.type) {
  case "rule":
    if (topRules.includes(rule.name.toUpperCase())) {
      return rr.ComplexDiagram(abnfToRailroad(rule.def));
    } else {
      return rr.Diagram(abnfToRailroad(rule.def));
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
  const abnf = await (await fetch(`https://dontcallmedom.github.io/rfcref/abnf/consolidated/rfc${num}.abnf`)).text();
  let dependencies = {};
  try {
    dependencies = await (await fetch(`https://dontcallmedom.github.io/rfcref/abnf/dependencies/rfc${num}.json`)).json();
  } catch (e) {

  }
  const rules = parse(abnf);
  const unreferencedDefs = Object.keys(rules.defs).filter(d => !rules.refs.find(r => r.name.toUpperCase() === d));
  console.log(unreferencedDefs);
  let h = "";
  const w = classSpanWrap(dependencies);
  for (const def of Object.values(rules.defs)) {
    h += serialize(def, w) + "\n\n";

    h += abnfToRailroad(def, unreferencedDefs).toString();
  }
  console.log(h);
  output.innerHTML = h;
}
