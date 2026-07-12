import fs from "fs";

const file = fs.readFileSync("fronted/lightweight-charts.js", "utf8");

const mockGlobal = {
  document: {
    createElement: () => ({
      appendChild: () => {},
      style: {},
      getContext: () => ({}),
      getBoundingClientRect: () => ({ width: 100, height: 100 })
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {}
    }
  },
  window: {
    getComputedStyle: () => ({ color: "rgb(0,0,0)" }),
    devicePixelRatio: 1
  }
};

mockGlobal.window.document = mockGlobal.document;

// Execute the minified code in a controlled context
const fn = new Function("window", "document", file + "\nreturn window;");
const win = fn(mockGlobal.window, mockGlobal.document);

console.log("Exports on window:", Object.keys(win).filter(k => k !== "document" && k !== "devicePixelRatio"));
if (win.LightweightCharts) {
  console.log("LightweightCharts keys:", Object.keys(win.LightweightCharts));
}
