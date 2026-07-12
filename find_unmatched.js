import fs from "fs";

const content = fs.readFileSync("fronted/app.js", "utf8");
const lines = content.split("\n");
const stack = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    if (char === "{") {
      stack.push({ line: i + 1, char: "{" });
    } else if (char === "}") {
      if (stack.length === 0) {
        console.log(`Unmatched } on line ${i + 1}`);
      } else {
        stack.pop();
      }
    }
  }
}

console.log("Unclosed braces opened at lines:", stack.map(s => s.line));
