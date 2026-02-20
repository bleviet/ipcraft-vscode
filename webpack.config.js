const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const commonResolve = {
  extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
};

const extensionModuleRules = {
  rules: [
    {
      test: /\.tsx?$/,
      use: "ts-loader",
      exclude: /node_modules/,
    },
    {
      test: /\.(woff2?|ttf|eot|otf)$/,
      type: "asset/resource",
    },
  ],
};

const webviewModuleRules = {
  rules: [
    {
      test: /\.tsx?$/,
      use: "ts-loader",
      exclude: /node_modules/,
    },
    {
      test: /\.css$/,
      use: [MiniCssExtractPlugin.loader, "css-loader", "postcss-loader"],
    },
    {
      test: /\.(woff2?|ttf|eot|otf)$/,
      type: "asset/resource",
    },
  ],
};

/** @type {import('webpack').Configuration} */
const extensionConfig = {
  name: "extension",
  mode: "development",
  devtool: "inline-source-map",
  target: "node",
  entry: {
    extension: "./src/extension.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
  },
  resolve: commonResolve,
  module: extensionModuleRules,
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "src", "generator", "templates"),
          to: "templates",
        },
        {
          from: path.resolve(__dirname, "ipcraft-spec", "common", "bus_definitions.yml"),
          to: "resources",
        },
      ],
    }),
  ],
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
  name: "webview",
  mode: "development",
  devtool: "inline-source-map",
  target: "web",
  entry: {
    webview: "./src/webview/index.tsx",
    ipcore: "./src/webview/ipcore/IpCoreApp.tsx",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    // NOTE: do NOT set libraryTarget to commonjs* for the webview.
  },
  resolve: commonResolve,
  module: webviewModuleRules,
  plugins: [new MiniCssExtractPlugin({ filename: "[name].css" })],
};

module.exports = [extensionConfig, webviewConfig];
