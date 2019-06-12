var winston = require('winston');
var logConfig = require(process.env.CONFIGS_DIR + '/logging.json');

const tsFormat = () => (new Date().toISOString());

//Get the filename for logging based on the parent module.
var parentModuleFilename = module.parent.filename;

modulename = parentModuleFilename.split('/').pop().split('.')[0];
console.log('Logging to file: ' + modulename + '.log');

const logger = winston.createLogger({
    transports: [
        new winston.transports.File({
            filename: '/var/log/node/' + modulename + '.log',
            timestamp: tsFormat,
            level: logConfig.level})
    ]
});

logger.level = 'debug';

module.exports = logger;
