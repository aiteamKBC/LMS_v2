const {getDefaultConfig} = require('expo/metro-config');
const fs = require('node:fs');
const path = require('node:path');
const config = getDefaultConfig(__dirname);
// A Windows short drive alias can point at an isolated build while dependencies
// live in a reused checkout. Metro must see the real targets of those junctions.
if (process.env.KBC_DEPENDENCY_ROOT) {
  const dependencies = fs.realpathSync(path.join(__dirname,'node_modules'));
  config.watchFolders = [...new Set([...config.watchFolders,
    fs.realpathSync(__dirname),dependencies,process.env.KBC_DEPENDENCY_ROOT])];
  config.resolver.nodeModulesPaths = [path.join(__dirname,'node_modules'),dependencies,
    path.join(process.env.KBC_DEPENDENCY_ROOT,'node_modules')];
}
module.exports = config;
