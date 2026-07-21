const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const root = __dirname;
const projectRoot = path.resolve(root, "..");

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
      use: [
        MiniCssExtractPlugin.loader,
        "css-loader",
        {
          loader: "postcss-loader",
          options: {
            postcssOptions: {
              config: path.resolve(root, "postcss.config.js"),
            },
          },
        },
      ],
    },
    {
      test: /\.(woff2?|ttf|eot|otf)$/,
      type: "asset/resource",
    },
    {
      test: /\.svg$/,
      type: "asset/source",
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
    extension: path.resolve(projectRoot, "src/extension.ts"),
  },
  output: {
    path: path.resolve(projectRoot, "dist"),
    filename: "[name].js",
    libraryTarget: "commonjs2",
  },
  externals: {
    vscode: "commonjs vscode",
  },
  resolve: commonResolve,
  module: extensionModuleRules,
  // Suppress known harmless warnings from nunjucks' optional Node.js file-loader
  // (dynamic require expression) and the macOS-only fsevents dependency.
  ignoreWarnings: [
    { module: /nunjucks/, message: /Critical dependency/ },
  ],
  plugins: [
    new webpack.IgnorePlugin({ resourceRegExp: /^fsevents$/ }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(projectRoot, "src", "generator", "templates"),
          to: "templates",
        },
        {
          from: path.resolve(projectRoot, "src", "generator", "packs"),
          to: "packs",
        },
        {
          from: path.resolve(projectRoot, "ipcraft-spec", "bus_definitions"),
          to: "resources/bus_definitions",
        },
        {
          from: path.resolve(projectRoot, "ipcraft-spec", "schemas", "ip_core.schema.json"),
          to: "resources/schemas/ip_core.schema.json",
        },
        {
          from: path.resolve(projectRoot, "ipcraft-spec", "schemas", "memory_map.schema.json"),
          to: "resources/schemas/memory_map.schema.json",
        },
        {
          from: path.resolve(projectRoot, "ipcraft-spec", "schemas", "data_inspector.schema.json"),
          to: "resources/schemas/data_inspector.schema.json",
        },
      ],
    }),
  ],
};

/** @type {import('webpack').Configuration} */
const cliConfig = {
  name: "cli",
  mode: "development",
  devtool: "inline-source-map",
  target: "node",
  entry: {
    cli: path.resolve(projectRoot, "src/cli/index.ts"),
  },
  output: {
    path: path.resolve(projectRoot, "dist"),
    filename: "[name].js",
    libraryTarget: "commonjs2",
  },
  // The CLI runs outside any VS Code host, so `vscode` is bundled as a lightweight shim
  // (not left external like the extension bundle) — see src/cli/vscodeShim.ts.
  resolve: {
    ...commonResolve,
    alias: {
      vscode: path.resolve(projectRoot, "src/cli/vscodeShim.ts"),
    },
  },
  module: extensionModuleRules,
  ignoreWarnings: [
    { module: /nunjucks/, message: /Critical dependency/ },
  ],
  plugins: [
    new webpack.IgnorePlugin({ resourceRegExp: /^fsevents$/ }),
    new webpack.BannerPlugin({ banner: "#!/usr/bin/env node", raw: true }),
  ],
};

/** @type {import('webpack').Configuration} */
const webviewConfig = {
  name: "webview",
  mode: "development",
  devtool: "inline-source-map",
  target: "web",
  entry: {
    webview: path.resolve(projectRoot, "src/webview/index.tsx"),
    ipcore: path.resolve(projectRoot, "src/webview/ipcore/IpCoreApp.tsx"),
    dataInspector: path.resolve(projectRoot, "src/webview/dataInspector/index.tsx"),
  },
  output: {
    path: path.resolve(projectRoot, "dist"),
    filename: "[name].js",
    // NOTE: do NOT set libraryTarget to commonjs* for the webview.
  },
  resolve: commonResolve,
  module: webviewModuleRules,
  plugins: [new MiniCssExtractPlugin({ filename: "[name].css" })],
  // Bundle size limits are intended for browser pages loaded over the network;
  // VS Code extension webviews are served locally so the warnings are noise.
  performance: { hints: false },
};

module.exports = [extensionConfig, webviewConfig, cliConfig];
