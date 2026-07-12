import fs from "fs";

const content = fs.readFileSync("fronted/lightweight-charts.js", "utf8");

// Look for addSeries or similar
const regex = /add[A-Z][a-zA-Z0-9_$]*/g;
const matches = content.match(regex);
console.log("Add methods:", [...new Set(matches)].filter(m => m.includes("Series") || m.includes("Chart")));
