const path = require("path");
module.exports = {
  mode: "production",
  entry: "./entry.js",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "melek-chain.js",
    library: "MelekChain",
    libraryTarget: "window",
  },
  resolve: {
    modules: [path.resolve("/opt/melek-bot/condenser/node_modules"), "node_modules"],
  },
  node: { global: true },
  performance: { hints: false },
};
