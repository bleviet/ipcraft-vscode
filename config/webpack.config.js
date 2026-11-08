const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");

const root = __dirname;
const projectRoot = path.resolve(root, "..");

const commonResolve = {
  extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
};

// Type-check only what the bundles actually import. Without this, ts-loader
// also walks the test tree on every build, which pushes the bundle step past
// the default Node heap. Full-program checking stays the job of
// `npm run type-check`, which CI runs as its own step.
const typescriptLoader = {
  loader: "ts-loader",
  options: {
    onlyCompileBundledFiles: true,
  },
};

const extensionModuleRules = {
  rules: [
    {
      test: /\.tsx?$/,
      use: typescriptLoader,
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
      use: typescriptLoader,
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
          from: path.resolve(projectRoot, "node_modules", "@fontsource", "ibm-plex-sans", "files", "ibm-plex-sans-latin-400-normal.woff"),
          to: "resources/fonts/[name][ext]",
        },
        {
          from: path.resolve(projectRoot, "node_modules", "@fontsource", "ibm-plex-sans", "files", "ibm-plex-sans-latin-600-normal.woff"),
          to: "resources/fonts/[name][ext]",
        },
        {
          from: path.resolve(projectRoot, "node_modules", "@fontsource", "ibm-plex-mono", "files", "ibm-plex-mono-latin-400-normal.woff"),
          to: "resources/fonts/[name][ext]",
        },
        // The rasterizer of `ipcraft render` (PNG and JPG), read as bytes by dist/cli.js.
        {
          from: path.resolve(projectRoot, "node_modules", "@resvg", "resvg-wasm", "index_bg.wasm"),
          to: "resources/resvg.wasm",
          // Copied as is.
          info: { minimized: true },
        },
        // One copy of the layout engine, loaded by the system viewer page (global ELK) and
        // required by dist/cli.js; neither bundle embeds it.
        {
          from: path.resolve(projectRoot, "node_modules", "elkjs", "lib", "elk.bundled.js"),
          to: "elk.bundled.js",
          // Copied as is: terser would minify it and drop the elkjs licence header.
          info: { minimized: true },
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
        {
          from: path.resolve(projectRoot, "ipcraft-spec", "schemas", "bus_definition.schema.json"),
          to: "resources/schemas/bus_definition.schema.json",
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
  externals: {
    "elkjs/lib/elk.bundled.js": "commonjs ./elk.bundled.js",
  },
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
    systemDiagram: path.resolve(projectRoot, "src/webview/systemDiagram/index.tsx"),
  },
  output: {
    path: path.resolve(projectRoot, "dist"),
    filename: "[name].js",
    // NOTE: do NOT set libraryTarget to commonjs* for the webview.
  },
  // The page loads dist/elk.bundled.js first; its UMD wrapper defines the global `ELK`.
  externals: {
    "elkjs/lib/elk.bundled.js": "ELK",
  },
  resolve: commonResolve,
  module: webviewModuleRules,
  plugins: [new MiniCssExtractPlugin({ filename: "[name].css" })],
  // Bundle size limits are intended for browser pages loaded over the network;
  // VS Code extension webviews are served locally so the warnings are noise.
  performance: { hints: false },
};

module.exports = [extensionConfig, webviewConfig, cliConfig];
