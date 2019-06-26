const logger = require('./utils/logger.js');
const clashapi = require('./utils/clashapi.js')
const Discord = require('discord.io');
const async = require('async');
const scheduler = require('node-schedule');
const moment = require('moment-timezone');
const axios = require('axios');
const cheerio = require('cheerio');

const discordAuth = require(process.env.CONFIGS_DIR + '/discord-auth.json');
const BOT_CONFIGS = require(process.env.CONFIGS_DIR + '/roaster-bot-configs.json');
const ALMOST_DIVORCED_SERVER_ID = BOT_CONFIGS.discordServerId;
const ROASTS_CHANNELID = BOT_CONFIGS.roastsChannelId;
const RESEARCH_DATA_BASEURL = 'https://clashofclans.fandom.com/wiki/';

const CLAN_BIRTHDAY = moment('28 Dec 2018','DD MMM YYYY');

const ROASTS = [];

const MAINTENANCE = BOT_CONFIGS.maintenance;

// ---- GLOBAL VARIABLES -----
var playersMap = {};
var responseChannelId = null;

// Initialize Discord Bot
var bot = new Discord.Client({
   token: discordAuth.roaster.token,
   autorun: true
});

//Try reconnecting if disconnected.
bot.on('disconnect', function(erMsg, code) {
    logger.warn('----- Bot disconnected from Discord with code', code, 'for reason:', erMsg, '-----');
    bot.connect();
});

bot.on('ready', function (evt) {
    var server = getServer();
    bot.setPresence({
        game: {name: 'Watching Almost Divorced'}
    });
    logger.info('Connected');
    logger.info('Logged in as: ');
    logger.info(bot.username + ' - (' + bot.id + ')');
    readRoasts();
});

bot.on('message', function (user, userID, channelID, message, evt) {
    console.log(userID + ': ' + message);
    // Our bot needs to know if it will execute a command
    // It will listen for messages that will start with `!`
    if (message.substring(0, 2) == 'r ') {
        var args = message.substring(2).split(' ');
        var cmd = args[0];

        args = args.splice(1);

        if (MAINTENANCE) {
            if (userID != 184262026565124097) {
                bot.sendMessage({
                        to: channelID,
                        message: 'AFK'});
                return;
            }
        }
        switch(cmd) {
            // !ping
            case 'help':
                help(channelID);
                break;
            case 'adhelp':
                help(channelID);
                break;
            case 'r':
            case 'roast':
                //if (LEADERS.includes(userID) || OFFICERS.includes(userID))
                    roast(channelID, args, userID);
                break;
         }
     } else {
        if (message.indexOf(BOT_CONFIGS.botUserId) >= 0) {
            responseChannelId = channelID;
            return;
        }
        if (channelID == BOT_CONFIGS.inputChannelId) {
            if (responseChannelId == null) responseChannelId = BOT_CONFIGS.defaultChannelId;
            bot.sendMessage({
                to: responseChannelId,
                embed: {
                    color: 13683174,
                    description: '' + message + '',
                    footer: {
                        text: ''
                    },
                    thumbnail: {
                        url: ''
                    },
                    title: '',
                    url: ''
                }
            });
        }
     }
});

function getServer() {
    return bot.servers[ALMOST_DIVORCED_SERVER_ID];
}

function readRoasts() {
    bot.getMessages({
        channelID: BOT_CONFIGS.roastsChannelId
    }, function(err, msgs){
        msgs.forEach( msg => {
            console.log(msg.content);
            ROASTS.push(msg.content);
        });
    });
}

function roast(channelID, args, userID) {
    var user = '<@' + userID + '>';
    if (args.length > 0) {
        var tmpUser = args.join(' ');
        if (tmpUser.indexOf(BOT_CONFIGS.botUserId) == -1)
            user = tmpUser;
    }
    var roastNum = random(ROASTS.length-1);
    bot.sendMessage({
        to: channelID,
        message: user + ' ' + ROASTS[roastNum]
    });
}



















function random(max) {
    return Math.floor(Math.random() * Math.floor(max));
}


function strip(someText) {
    someText = someText.replace(/(\r\n|\n|\r)/gm,"");
    someText = someText.replace(/,/gm,"");
    someText = someText.trim();
    return someText;
}

const sleep = (milliseconds) => {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function getKeyByValue(object, value) {
  return Object.keys(object).find(key => object[key] === value);
}
