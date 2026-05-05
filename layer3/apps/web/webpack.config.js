const path = require("path");

const development = process.env.NODE_ENV !== "production";

module.exports = {
  context: path.resolve(__dirname, "../../"),
  entry: {
    qp: "./src/index.ts",
    dashboard: "./apps/web/dashboard/dashboard.ts",
    insights: "./apps/web/dashboard/insights.ts"
  },
  output: {
    library: "QP",
    libraryTarget: "umd",
    filename: development ? "[name].js" : "[name].min.js",
    path: path.resolve(__dirname, "../../dist")
  },
  optimization: {
    minimize: !development
  },
  resolve: {
    extensions: [".ts", ".js"],
    alias: {
      "@layer3/core": path.resolve(__dirname, "../../packages/core/src")
    }
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: "ts-loader",
        options: {
          configFile: path.resolve(__dirname, "../../tsconfig.web.json")
        }
      }
    ]
  }
};
