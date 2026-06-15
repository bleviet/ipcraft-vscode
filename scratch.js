const { IpCoreScaffolder } = require('./out/generator/IpCoreScaffolder.js');
const { TemplateLoader } = require('./out/generator/TemplateLoader.js');
const { devResourceRoots } = require('./out/services/ResourceRoots.js');
const { Logger } = require('./out/utils/Logger.js');
const path = require('path');

(async () => {
  const logger = new Logger('test');
  const loader = new TemplateLoader(logger, path.resolve(__dirname, 'src/generator/templates'));
  const roots = devResourceRoots(__dirname);
  const scaffolder = new IpCoreScaffolder(logger, loader, roots);
  const result = await scaffolder.generateAll(path.resolve(__dirname, 'src/test/fixtures/sc-ipcore.yml'), '/tmp/sc-out', {
    includeRegs: true,
    includeTestbench: false,
    targets: [],
    ipCraftMethodology: true,
    hdlLanguage: 'vhdl',
  });
  console.log(Object.keys(result.generatedContents || {}));
})();
