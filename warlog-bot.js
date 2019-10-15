const fs = require('fs');
const logger = require('./utils/logger.js');
const readline = require('readline');
const {google} = require('googleapis');
const models = require('./model/clashmodels.js');
const async = require('async');
const Discord = require('discord.io');
const moment = require('moment-timezone');
const clashapi = require('./utils/clashapi.js');
const stringify = require('json-stable-stringify');

var discordAuth = require(process.env.CONFIGS_DIR + '/discord-auth.json');
var googleCredentials = require(process.env.CONFIGS_DIR + '/googleapi-credentials.json');
const BOT_CONFIGS = require(process.env.CONFIGS_DIR + '/warlog-bot-configs.json');

//Initialize Google Auth and get/refresh Token
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', ];
const TOKEN_PATH = process.env.CONFIGS_DIR + '/warlogbot-googletoken.json';
const SPREADSHEET_ID = BOT_CONFIGS.spreadsheetId;
const ALMOST_DIVORCED_SERVER_ID = BOT_CONFIGS.discordServerId;
const STAR_EMPTY = '☆'; 
const STAR_FULL = '⭐'; 
const THUMBSUP = '👍';
const ROSTER='ROSTER';
const CLAIMS = BOT_CONFIGS.claimsTabName;
const CLAIMS_SHEET_ID = BOT_CONFIGS.claimsSheetId;
const CLAN_FAMILY = BOT_CONFIGS.clanFamily;
const MAX_ROWS = 150;
const EXCLUSION_COLUMN = 'E';
const WIN_COLOR = {"red": 0.41568628, "green": 0.65882355, "blue": 0.30980393};
const LOSS_COLOR = {"red": 0.8};
const CHANNELS = {};
const MASTER_ROSTER_SHEET = "ROSTER";
const ONE_HOUR = 3600000;
const ONE_MIN = 60000;

const MAINTENANCE = false;

// ------------ GLOBAL RESUABLES  ---------------

const botOperationQueue = new Queue();
const interestedMessageIds = {};

var warLogUpdater;
var warLogUpdateInterval;
var opponentClanTagUpdater;
var opponentClanTag = null;
var previousAttackSummary = null;
var warLogLastUpdateTime = new Date().getTime();
var responseChannelId = null;

// ------------ TIMERS FOR THE BOT! -------------
//Check for claims and remind players every 4mins.
setTimeout(function() {
    authorize(googleCredentials, checkClaims);
}, 240000);

setTimeout(function() {
    authorize(googleCredentials, function(auth) {
        for(clanTag in CLAN_FAMILY) {
            //Start a timer to update war log ever 30secs initially.
            scheduleWarLogUpdater(30000, clanTag);
            //Start a notification thread for war start time for each clan.
            checkAndStartWarNotificationThread(auth, clanTag);
        }
    });
}, 10000);

//Refersh Clan Tag every 1 hr.
// opponentClanTagUpdater = setInterval( function() {
//     opponentClanTag = null;
// }, 3600000);

// Initialize Discord Bot
var bot = new Discord.Client({
   token: discordAuth.warlog.token,
   autorun: true
});

//Try reconnecting if disconnected. 
bot.on('disconnect', function(erMsg, code) {
    logger.warn('----- Bot disconnected from Discord with code', code, 'for reason:', erMsg, '-----');
    bot.connect();
});

bot.on('ready', function (evt) {
    var server = getServer();
    cacheUserRoles(server);
    bot.setPresence({
        game: {name: 'Clash of Clans'}
    });
    logger.info('Connected');
    logger.info('Logged in as: ');
    logger.info(bot.username + ' - (' + bot.id + ')');
});

bot.on('message', function (user, userID, channelID, message, evt) {
    // Our bot needs to know if it will execute a command
    // It will listen for messages that will start with `!`
    if (message.substring(0, 1) == '!') {
        var args = message.substring(1).split(' ');
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
        switch(cmd.toLowerCase()) {
            // !ping
            case 'ping':
                bot.sendMessage({
                    to: channelID,
                    message: 'I am here!'
                });
                break;
            case 'help':
                help(channelID);
                break;
            case 'adhelp':
                help(channelID);
                break;
            case 'details':
                authorize(googleCredentials, summary.bind({'channelID': channelID, 'detail': false}));
                break;
            case 'summary':
                authorize(googleCredentials, summary.bind({'channelID': channelID, 'detail': false}));
                break;
            case 'psummary':
                authorize(googleCredentials, summary.bind({'channelID': channelID, 'detail': true}));
                break;
            case 'link':
                if (isPrivileged(userID, channelID, cmd, true))
                    authorize(googleCredentials, link.bind({'channelID': channelID, 'args': args}));
                break;
            case 'pnotify':
                if (isPrivileged(userID, channelID, cmd))
                    authorize(googleCredentials, notify.bind({'channelID': channelID, 'args': args}));
                break;
            case 'claims':
                authorize(googleCredentials, claims.bind({'channelID': channelID}));
                break;
            case 'roster':
                authorize(googleCredentials, roster.bind({'channelID': channelID}));
                break;
            case 'claim':
                if (isPrivileged(userID, channelID, cmd))
                    authorize(googleCredentials, claim.bind({'channelID': channelID, 'args': args}));
                break;
            case 'unclaim':
                if (isPrivileged(userID, channelID, cmd))
                    authorize(googleCredentials, unclaim.bind({'channelID': channelID, 'args': args}));
                break;
            case 'a':
            case 'attack':
                if (isPrivileged(userID, channelID, cmd))
                    authorize(googleCredentials, attack.bind({'channelID': channelID, 'args': args}));
                break;
            case 'endwar':
                if (isPrivileged(userID, channelID, cmd))
                    authorize(googleCredentials, endwar.bind({'channelID': channelID, 'args': args}));
                break;
            case 'addwar':
                if (isPrivileged(userID, channelID, cmd))
                    authorize(googleCredentials, addwar.bind({'channelID': channelID, 'args': args}));
                break;
            case 'g':
                if (isPrivileged(userID, channelID, cmd))
                    authorize(googleCredentials, getWarRoster.bind({'channelID': channelID, 'args': args}));
                break;
            case 'in':
                if (isPrivileged(userID, channelID, cmd))
                    authorize(googleCredentials, updateRoster.bind({'channelID': channelID, 'args': args, 'inc': true, messageID: evt.d.id}));
                break;
            case 'out':
                if (isPrivileged(userID, channelID, cmd))
                    authorize(googleCredentials, updateRoster.bind({'channelID': channelID, 'args': args, 'inc': false, messageID: evt.d.id}));
                break;
            case 'confirmroster':
                if (isPrivileged(userID, channelID, cmd))
                    authorize(googleCredentials, confirmRoster.bind({'channelID': channelID, 'args': args}));
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

function cacheUserRoles(server) {
    var channels = server.channels;
    for(var id in channels) {
        CHANNELS[channels[id].name] = id;
        console.log(id + " - " + channels[id].name);
    }
    var roles = server.roles;
    var officer_role_id = '';
    var leader_role_id = '';

    console.log("Roles->");
    for(var roleid in roles) {
        var role = roles[roleid];
        console.log(role.id + " - " + role.name);
    }

    var members = server.members;
    for(var memberid in members) {
        var member = members[memberid];
        for(var clanTag in CLAN_FAMILY) {
            clanFamilyPrefs = CLAN_FAMILY[clanTag];
            if (!("privilegedMembers" in clanFamilyPrefs)) 
                clanFamilyPrefs["privilegedMembers"] = [];
            privilegedRoleIds =  clanFamilyPrefs.privilegedRoleIds;
            clanFamilyPrefs.privilegedRoleIds.forEach(roleId => {
                if (roleId && member.roles.includes(roleId))
                    clanFamilyPrefs["privilegedMembers"].push(member.id);
            });
        }
    }
}

function scheduleWarLogUpdater(timeInMilliSeconds, clanTag) {
    var clanFamilyPrefs = CLAN_FAMILY[clanTag];
    if ("warLogUpdateInterval" in clanFamilyPrefs) {
        if (timeInMilliSeconds == clanFamilyPrefs["warLogUpdateInterval"]) return;
        if ("clanwarLogUpdater" in clanFamilyPrefs && clanFamilyPrefs["clanwarLogUpdater"])
            clearInterval(clanFamilyPrefs["clanwarLogUpdater"]);
    }

    // Update war log every 30secs.
    clanFamilyPrefs["clanwarLogUpdater"] = setInterval( function() {
        authorize(googleCredentials, fetchAndUpdateWarLog.bind({clanTag: clanTag}));
    }, timeInMilliSeconds);
    logger.debug("Scheduled warlog updater thread for '" + clanTag + "'");
    clanFamilyPrefs["warLogUpdateInterval"] = timeInMilliSeconds;
}

function fetchAndUpdateWarLog(auth) {
    var clanTag = this.clanTag;
    const sheets = google.sheets({version: 'v4', auth});
    var clanFamilyPrefs = CLAN_FAMILY[clanTag];
    if ("opponentClanTag" in clanFamilyPrefs && clanFamilyPrefs["opponentClanTag"] && clanFamilyPrefs["opponentClanTag"]!='X') {
        clashapi.getAttackSummary('', clanFamilyPrefs["opponentClanTag"], _updateWarLog.bind({auth: auth, clanTag: clanTag}));
        return;
    }
    if ("cwlInterval" in clanFamilyPrefs && clanFamilyPrefs.cwlInterval!=null) return;
    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: clanFamilyPrefs.warsheet+'!G1:G3',
    }, (err, res) => { 
        if(err) {
            logger.warn('Unable to fetch opponent clan Tag.');
            return;
        }
        if (!res.data.values) return;
        if (res.data.values.length > 2 && res.data.values[2][0] != 'X') { //Final Score (G3) should be 'X' for an active war.
            clanFamilyPrefs["opponentClanTag"] = 'X';
            logger.info('No new war. Rescheduling update interval for "' + clanTag + '"');
            scheduleWarLogUpdater(ONE_HOUR, clanTag);
        } else if (res.data.values[0][0] == 'CWL') {
            startCWLThread(clanTag, auth);
        } else {
            clanFamilyPrefs["opponentClanTag"] = res.data.values[1][0];
            clashapi.getAttackSummary('', clanFamilyPrefs["opponentClanTag"], _updateWarLog.bind({auth: auth, clanTag: clanTag}));
        }
    });
}

function _updateWarLog(err, attackSummary) {
    var auth = this.auth;
    var clanTag = this.clanTag;
    var warsheet = CLAN_FAMILY[clanTag].warsheet;
    var baseStatusColumn = CLAN_FAMILY[clanTag].baseStatusColumn;

    if (err) {
        if (err.code == 100) {
            var duration = err.startTime.diff(moment(), 'milliseconds');
            logger.info('War starts in - ' + duration + 'ms. Rescheduling the update interval. "' + clanTag + '"');
            if (duration > 0) {
                scheduleWarLogUpdater(duration, clanTag);
            }
            return;
        } else if (err.code == 403) {
            logger.info('War log is not public. Changing the update interval to 1hr. "' + clanTag + '"');
            scheduleWarLogUpdater(ONE_HOUR, clanTag);
            return;
        } else if (err.code == 1000) {
            logger.info('War ended for clan ":' + clanTag + '"');
            attackSummary = err.attackSummary;
            CLAN_FAMILY[clanTag].opponentClanTag = 'X';
        } else {
            logger.info('Error while fetching war log: ' + err);
            return;
        }
    }
    scheduleWarLogUpdater(30000, clanTag);
    const sheets = google.sheets({version: 'v4', auth});
    sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [warsheet+'!A5:D54', warsheet+'!E5:E54']
    }, (err, res) => { 
        if(err) {
            logger.warn('Unable to fetch Clan Members data from Sheets.');
            return;
        }
        // //If last update was more than 5 mins ago, we force an update.
        // if ((new Date().getTime() - warLogLastUpdateTime) > 300000) previousAttackSummary = null;
        // if (previousAttackSummary) {
        //     if (stringify(previousAttackSummary) === stringify(attackSummary)) {
        //         logger.info('No change in war log. Skipping updates.');
        //         previousAttackSummary = attackSummary;
        //         return;
        //     }
        // }
        // previousAttackSummary = attackSummary;
        var playersData = res.data.valueRanges[0].values;
        var claims = res.data.valueRanges[1].values;
        var idx = 0;
        var warLogUpdate = [];
        var messages = [];
        var updateData = [];
        var resolvedClaims = []; // Array of Arrays - [PlayerName, DiscordId, ClaimedNum., StarsGained]
        var discordChannelId = CLAN_FAMILY[clanTag].discordChannelId;
        for(var i=0; i<playersData.length; i++) {
            var playerTag = playersData[i][1];
            if (playerTag in attackSummary) {
                var playerAttacks = attackSummary[playerTag];
                if ('attack1' in playerAttacks) {
                    if (claims && claims[i] && claims[i][0] != '' && ''+claims[i][0] == ''+playerAttacks.attack1.base) {
                        if (playersData[i].length>3) resolvedClaims.push([playersData[i][0], playersData[i][3], claims[i][0], playerAttacks.attack1.stars]);
                        updateData.push({range: warsheet+'!E'+(i+5), values: [['']]});
                    }
                    if ('attack2' in playerAttacks) {
                        if (claims && claims[i] && claims[i][0] != '' && ''+claims[i][0] == ''+playerAttacks.attack2.base) {
                            if (playersData[i].length>3) resolvedClaims.push([playersData[i][0], playersData[i][3], claims[i][0], playerAttacks.attack2.stars]);
                            updateData.push({range: warsheet+'!E'+(i+5), values: [['']]});
                        }
                        warLogUpdate.push([ playerAttacks.attack1.stars,playerAttacks.attack2.stars ]);
                    } else {
                        warLogUpdate.push([ playerAttacks.attack1.stars,'XXX' ]);
                    }
                } else {
                    warLogUpdate.push([ 'XXX','XXX' ]);
                }
            } else {
                warLogUpdate.push([ '-','-' ]);
            }
        }
        var baseStatus = [];
        attackSummary.baseStatus.map( (stars) => {
            if (stars == null) stars = '';
            baseStatus.push([stars]);
        });
        updateData.push({range: warsheet+'!G5:H'+ (warLogUpdate.length+4),values: warLogUpdate});
        updateData.push({range: CLAIMS+'!'+baseStatusColumn+'4:'+baseStatusColumn+(baseStatus.length+3),values: baseStatus});
        sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                data: updateData,
                valueInputOption: 'USER_ENTERED'
            }
        }, (err, result) => {
            if (err) {
                logger.error('Error while updating war log! ' + err);
                previousAttackSummary = null;
                return;
            }
            logger.info('Successfully updated war log.');
            warLogLastUpdateTime = new Date().getTime();
        });
        var sleepDuration = 0;
        resolvedClaims.forEach(resolvedClaim => {
            if ( !resolvedClaim[1] ) return;
            if (''+resolvedClaim[3] == '3') {
                var msg = '<@' + resolvedClaim[1] + '> Goodjob by ' + resolvedClaim[0] + ' on #' + resolvedClaim[2] + '!';
                sleep(sleepDuration).then(() => {
                    bot.sendMessage({
                        to: discordChannelId,
                        message: msg
                    });
                });
            } else {
                var msg = '<@' + resolvedClaim[1] + '> Tough break on #' + resolvedClaim[2] + '! Better luck next time!';
                sleep(sleepDuration).then(() => { 
                    bot.sendMessage({
                        to: discordChannelId,
                        message: msg
                    });
                });
            }
            sleepDuration += 5;
        });
        logger.info('Updating war log for "' + clanTag + '"');
    });
}

function checkAndStartWarNotificationThread(auth, clanTag) {
    if (!clanTag)
        clanTag = this.clanTag;
    var clanFamilyPrefs = CLAN_FAMILY[clanTag];

    const sheets = google.sheets({version: 'v4', auth});

    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: CLAIMS+'!'+clanFamilyPrefs.baseStatusColumn+'3'
    }, (err, res) => {
        if (err) {
            console.log(err);
            return;
        }
        var startTimeStr = null;
        if (res.data.values && res.data.values.length > 0 && res.data.values[0] && res.data.values[0][0])
            startTimeStr = res.data.values[0][0];
        if (startTimeStr != null) {
            // startTimeStr = startTimeStr.slice(0, -5);
            var startTime = moment(startTimeStr, 'YYYYMMDDTHHmmss.SSSZ');
            //var duration = startTime.diff(moment(), 'milliseconds');
            warNotification(startTime, clanTag);
        }
    });
}

function warNotification(startTime, clanTag) {
    var message = this.message;
    if (arguments.length == 0) {
        startTime = this.startTime;
        clanTag = this.clanTag;
    }
    if (message && message.length > 0) {
        var clanFamilyPrefs = CLAN_FAMILY[clanTag];
        bot.sendMessage({
            to: clanFamilyPrefs.discordChannelId,
            message: message
        });
    }
    var duration = startTime.diff(moment(), 'milliseconds');
    if ((duration-3600000) > 0) {
        setTimeout(warNotification.bind({
            startTime: startTime,
            clanTag: clanTag,
            message: "⚔ War starting in 1 hr ⚔"
        }), duration-3600000);
    } else if (duration+10000 > 0) {
        setTimeout(warNotification.bind({
            startTime: startTime,
            clanTag: clanTag,
            message: "⚔ War started ⚔"
        }), duration+10000);
    } else if (ONE_HOUR*23+duration > 0) {
        setTimeout(warNotification.bind({
            startTime: startTime,
            clanTag: clanTag,
            message: "⚔ War ending in 1hr. Get your attacks in! ⚔"
        }), ONE_HOUR*23+duration);
    } else if (ONE_HOUR*24+duration > 0) {
        setTimeout(warNotification.bind({
            startTime: startTime,
            clanTag: clanTag,
            message: "⚔ War has ended ⚔"
        }), ONE_HOUR*24+duration);
    }
}

function help(channelID) {
    bot.sendMessage({
        to: channelID,
        embed: {
            color: 13683174,
            description: '',
            footer: { 
                text: '© Almost Divorced Clan'
            },
            thumbnail: {
                url: ''
            },
            title: 'Almost Divorced Commands',
            fields: [{
                name: '!ping',
                value: 'Check if I am alive and kicking!'
            }, {
                name: '!help',
                value: 'Just like any other bot ... You will get to know my buttons!'
            }, {
                name: '!adhelp',
                value: 'I prefer you use this instead of simply calling for help!'
            }, {
                name: '!details',
                value: 'Provides War Member attack details!'
            }, {
                name: '!summary',
                value: 'Provides a short War Summary. If output is not to your liking, check with @Mac!'
            }, {
                name: '!psummary',
                value: 'Provides a short War Summary and pending Attacks.'
            }, {
                name: '!link <player name or player tag> @<discord name>',
                value: 'Links the discord id of the player with the ingame player name.'
            }, {
                name: '!claims',
                value: 'Shows all the current active claims.'
            }, {
                name: '!claim <player name> <base num>',
                value: 'Add a claim for a base and start cooking! Warns every 4 mins after 30 mins and then removes the claim after 1hr.'
            }, {
                name: '!pnotify',
                value: 'Calls out to peeps with attacks left in war.'
            }, {
                name: '!unclaim <base num>',
                value: 'Remove somebody\'s claim on the give base number. To be used for switching targets.'
            }, {
                name: '!unclaim <player name>',
                value: 'In case you dont remember which base was claimed by the player.'
            }, {
                name: '!attack <base num> <num stars>',
                value: 'Removes the claim if there was one and updates the Excel Sheet war log. '
            }, {
                name: '!attack <player name> <base num> <num stars>',
                value: 'Updates the "Excel Sheet" with all the info.. Use this if there wasnt a claim for the base.'
            }, {
                name: '!endwar <w/l> <finalscore>',
                value: 'Closes the current war in progress with the final score.'
            }, {
                name: '!addwar <opponent clanTag> <roster size> <starts in>',
                value: 'Adds a new War column with the given opponent clan tag. If warlog is not public, this command needs to be followed with !in / !out / !confirm'
            }, {
                name: '!in <roster num> <roster num> ... ...',
                value: 'Includes the members in the war roster. An active war roster build shoudl be in progress for this to work.'
            }, {
                name: '!in <player name> <roster num>',
                value: 'Includes the given player in the war roster at the specified number.'
            }, {
                name: '!out <roster num> <roster num> ... ...',
                value: 'Removes the members from the war roster. An active war roster build shoudl be in progress for this to work.'
            }, {
                name: '!confirmroster',
                value: 'Locks down the war roster for this war.'
            }]
          }
    })
}

function startCWLThread(clanTag, auth) {
    var clanFamilyPrefs = CLAN_FAMILY[clanTag];
    if (!("cwlInterval" in clanFamilyPrefs) || clanFamilyPrefs.cwlInterval==null) {
        clanFamilyPrefs["cwlInterval"] = setInterval(function() {
            authorize(googleCredentials, fetchAndUpdateCWLLog.bind({clanTag: clanTag}));
        }, ONE_MIN);
        logger.info("Scheduled CWL Log updater thread for '" + clanTag + "'");
    }
}

function endCWLThread(clanTag) {
    var clanFamilyPrefs = CLAN_FAMILY[clanTag];
    if ("cwlInterval" in clanFamilyPrefs && clanFamilyPrefs['cwlInterval']) {
        clearInterval(clanFamilyPrefs.cwlInterval);
        clanFamilyPrefs.cwlInterval = null;
    }
}

function fetchAndUpdateCWLLog(auth) {
    var clanTag = this.clanTag;
    var clanFamilyPrefs = CLAN_FAMILY[clanTag];
    const sheets = google.sheets({version: 'v4', auth});

    if (!("round" in clanFamilyPrefs) || clanFamilyPrefs.round == null) {
        clanFamilyPrefs["round"] = 1;
        clanFamilyPrefs["cwlWarTag"] = null;
    }

    var round = clanFamilyPrefs.round;
    if (clanFamilyPrefs.cwlWarTag == null) {
        clashapi.getCWLWarTag(clanTag, clanFamilyPrefs.round, function(err, warTagAndName) {
            if (err) {
                if (err.code = 901) {
                    clanFamilyPrefs.round = clanFamilyPrefs.round-1;
                }
                return;
            }
            clanFamilyPrefs.cwlWarTag = warTagAndName.warTag;
            var baseStatusColumn = clanFamilyPrefs.baseStatusColumn;
            if (warTagAndName.state == 'preparation' || warTagAndName.state == 'inWar') warTagAndName.state = 'P';
            sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    data: [
                        {
                            range: 'CWL!' + String.fromCharCode(69+round)+(clanFamilyPrefs.cwlWarTagRow-1) + ':'+ String.fromCharCode(69+round)+(clanFamilyPrefs.cwlWarTagRow),
                            values: [[warTagAndName.opponentName],[warTagAndName.state]]
                        },
                        { 
                            range: 'CLAIMS!' + baseStatusColumn + '3',
                            values: [[warTagAndName.startTime]]
                        }
                    ],
                    valueInputOption: 'USER_ENTERED'
                }
            }, (err, res) => {
                if (err) 
                    console.log(err);
                return;
            });
            _updateCWLLog(sheets, clanTag);
        });
    } else {
        _updateCWLLog(sheets, clanTag);
    }
}

function _updateCWLLog(sheets, clanTag) {
    var clanFamilyPrefs = CLAN_FAMILY[clanTag];
    var round = clanFamilyPrefs.round;
    clashapi.getCWLAttackSummary(clanFamilyPrefs.cwlWarTag, function(err, cwlWarData) {
        if(err) {
            console.log(err);
            return;
        }
        var result = 'P';
        if (cwlWarData.state == "warEnded") {
            if (clanFamilyPrefs.round >= 7) {endCWLThread(clanTag); return;}
            clanFamilyPrefs.round = clanFamilyPrefs.round+1;
            clanFamilyPrefs.cwlWarTag = null;
            var stars1 = cwlWarData.clan.stars;
            var stars2 = cwlWarData.opponent.stars;
            var destruction1 = cwlWarData.clan.destructionPercentage;
            var destruction2 = cwlWarData.opponent.destructionPercentage;
            if (stars1 > stars2) result = 'W';
            else if (stars2 > stars1) result = 'L';
            else {
                if (destruction1 > destruction2) result = 'W';
                else if (destruction2 > destruction1) result = 'L';
                else result = 'D';
            }
        }
        var members = null;
        if (cwlWarData.clan.tag == clanTag)
            members = cwlWarData.clan.members;
        else {
            members = cwlWarData.opponent.members;
            if (result == 'L') result = 'W';
            else if (result == 'W') result = 'L';
        }
        //Get Player Tags in CWL for updating scores.
        sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'CWL!B' + (clanFamilyPrefs.cwlWarTagRow+2) + ':L' + (clanFamilyPrefs.cwlWarTagRow+25),
        }, (err, res) => {
            if (err) {
                console.log(err);
                return;
            }
            var scoresArray = [];
            var sheetCWLData = res.data.values;

            var memberCount = 0;
            while(true) {
                if (sheetCWLData[memberCount] && sheetCWLData[memberCount][round+3])
                    scoresArray.push([sheetCWLData[memberCount][round+3]]);
                else
                    break;
                memberCount++;
            }
            members.forEach( member => {
                if ("attacks" in member) {
                    var memberIdx = search2D(sheetCWLData, 0, member.tag);
                    var attack = member["attacks"][0];
                    scoresArray[memberIdx][0] = attack.stars;
                }
            });
            var updateData = [];
            updateData.push({range: 'CWL!'+String.fromCharCode(69+round)+(clanFamilyPrefs.cwlWarTagRow+2)+':'+String.fromCharCode(69+round)+(clanFamilyPrefs.cwlWarTagRow+2+memberCount),
                             values: scoresArray });
            if (result != 'P') {
                updateData.push({range: 'CWL!'+String.fromCharCode(69+round)+clanFamilyPrefs.cwlWarTagRow, values: [[result]]});
//                 var claimsData = []
//                 for(var i=0;i<memberCount;i++) claimsData.push([""]);
//                 updateData.push({range: 'CWL!E'+(clanFamilyPrefs.cwlWarTagRow+2)+':E'+(clanFamilyPrefs.cwlWarTagRow+2+memberCount),
//                                  values: claimsData})
            }
            sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    data: updateData,
                    valueInputOption: 'USER_ENTERED'
                }
            }, (err, res) => {
                if (err) 
                    console.log(err);
                return;
            });
        });
    });
}

function addwar(auth) {
    const sheets = google.sheets({version: 'v4', auth});
    const channelID = this.channelID;
    var args = this.args;
    var opponentClanTag = args[0];
    var warSize = 40;
    var startsIn = null;
    if (args.length > 1)
        warSize = parseInt(args[1]);
    if (args.length > 2)
        startsIn = args[2];

    var clanFamilyPrefs = getPreferencesFromChannel(channelID);
    if (clanFamilyPrefs == null) {
        unknownChannelMessage(channelID);
        return ;
    }

    var warsheet = clanFamilyPrefs.warsheet;
    var sheetId = clanFamilyPrefs.sheetId;
    bot.simulateTyping( channelID );

    sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        ranges:[ warsheet+'!G1:G4'],
        includeGridData: true
    }, (err, res) => {
        var lastWarLog = res.data.sheets[0].data[0].rowData;
        
        var clanTagCell = lastWarLog[1].values[0];
        var lastOpponentTag = "";
        var lastOpponent = "";
        if ("formattedValue" in clanTagCell) {
            lastOpponentTag = clanTagCell.formattedValue;
            lastOpponent = lastWarLog[0].values[0].formattedValue;
        }

        if (lastOpponentTag == opponentClanTag) {
            bot.sendMessage({
                to: channelID,
                message: "War with **" + lastOpponent + "** *(" + lastOpponentTag + ")* is already in progress."
            });
            return;
        }
        var backgroundColor = clanTagCell.effectiveFormat.backgroundColor;
        if (backgroundColor.red == 1) {
            bot.sendMessage({
                to: channelID,
                message: "Please end the war with **" + lastOpponent + "** *(" + lastOpponentTag + ")* using `!endwar` command."
            });
            return;
        }
        var warDate = moment(new Date()).format('D MMM YYYY');
        clashapi.getClanInfo(opponentClanTag, (err, clanInfo) => {
            if (err) {
                if (err.code == 404) {
                    bot.sendMessage({
                        to: channelID,
                        message: "Invalid clan tag - '"+opponentClanTag+"'"
                    });
                    return;
                }
                bot.sendMessage({
                    to: channelID,
                    message: "Couldnt get Opponent Clan information!"
                });
                return;
            }
            //20190911T173250.000Z
            var warStartTime = "";
            clanFamilyPrefs["opponentClanTag"] = 'X';
            if (!clanInfo.isWarLogPublic && startsIn==null) {
                bot.sendMessage({
                    to: channelID,
                    message: 'War Log is not public. I need to know when the war days starts! \n !addwar <opponent clanTag> <roster size> <starts in> (eg. 10h3m)'
                });
                return;
            } else if (!clanInfo.isWarLogPublic && startsIn!=null) {
                startsIn = startsIn.toLowerCase();
                var timeToBeAdded = 0;
                if (startsIn.indexOf('h') > 0) {
                    timeToBeAdded += (parseInt(startsIn.split('h')[0]) * 60);
                    if (startsIn.split('h').length > 0) startsIn = startsIn.split('h')[1];
                } 
                if (startsIn.indexOf('m') > 0) {
                    timeToBeAdded += parseInt(startsIn.split('m')[0]);
                }
                var warStartTime = moment();
                warStartTime.add(timeToBeAdded, 'minutes');
                warStartTime = warStartTime.format('YYYYMMDDTHHmmss.SSSZ');
            }

            var baseStatusColumn = clanFamilyPrefs.baseStatusColumn;
            var basesAttackedColumn = clanFamilyPrefs.basesAttackedColumn;
            var baseStatuses = [];
            var basesAttacked = [];
            for(var i=0; i<warSize; i++) {
                baseStatuses.push({"values": [{"userEnteredValue": {"stringValue": ""}}]});
            }
            for(var i=0; i<MAX_ROWS; i++) {
                basesAttacked.push({"values": [{"userEnteredValue": {"stringValue": ""}}]});
            }
            var addWarReq = {
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    requests: [{
                        "insertRange": {
                            "range": {
                                "sheetId": sheetId,
                                "startColumnIndex": 4,
                                "endColumnIndex": 6,
                            },
                            "shiftDimension": "COLUMNS"
                        }
                    },{
                        "mergeCells": {
                            "range": {
                                "sheetId": sheetId,
                                "startRowIndex": 0,
                                "startColumnIndex": 6, 
                                "endRowIndex": 4,
                                "endColumnIndex": 8
                            },
                            "mergeType": "MERGE_ROWS"
                        }
                    },{
                        "updateCells": {
                            "rows": [{
                                "values": [{
                                    "userEnteredValue": {
                                        "stringValue": clanInfo.name
                                    }
                                }]
                            },{
                                "values": [{
                                    "userEnteredValue": {
                                        "stringValue": opponentClanTag
                                    }
                                }]
                            },{
                                "values": [{
                                    "userEnteredValue": {
                                        "stringValue": "X"
                                    }
                                }]
                            },{
                                "values": [{
                                    "userEnteredValue": {
                                        "stringValue": warDate
                                    }
                                }]
                            }],
                            "fields": "userEnteredValue/stringValue",
                            "range": {
                                "sheetId": sheetId,
                                "startRowIndex": 0,
                                "startColumnIndex": 6,
                                "endRowIndex": 4,
                                "endColumnIndex": 7
                            }
                        }
                    },{
                        "updateCells": {
                            "rows": [{"values": [{"userEnteredValue": {"numberValue": warSize}}]}, {"values": [{"userEnteredValue": {"stringValue": warStartTime}}]}],
                            "fields": "userEnteredValue/stringValue",
                            "range": {
                                "sheetId": CLAIMS_SHEET_ID,
                                "startRowIndex": 1,
                                "startColumnIndex": baseStatusColumn.charCodeAt(0)-"A".charCodeAt(0),
                                "endRowIndex": MAX_ROWS,
                                "endColumnIndex": baseStatusColumn.charCodeAt(0)+1-"A".charCodeAt(0),
                            }
                        }
                    },{
                        "updateCells": {
                            "rows": [],
                            "fields": "userEnteredValue/stringValue",
                            "range": {
                                "sheetId": CLAIMS_SHEET_ID,
                                "startRowIndex": 1,
                                "startColumnIndex": basesAttackedColumn.charCodeAt(0)-"A".charCodeAt(0),
                                "endRowIndex": MAX_ROWS,
                                "endColumnIndex": basesAttackedColumn.charCodeAt(0)+1-"A".charCodeAt(0),
                            }
                        }
                    }],
                }
            };
            sheets.spreadsheets.batchUpdate(addWarReq, (err, res)=> {
                if (err) console.log(err);
                if (clanInfo.isWarLogPublic) {
                    logger.info("Updating War Roster");
                    bot.sendMessage({
                        to: channelID,
                        message: 'Ok. War Log is public. Setting up roster. I got this!'
                    });                    
                    setupWarRosterForPublicWarlog(auth, channelID, clanInfo.tag);
                } else {
                    bot.sendMessage({
                        to: channelID,
                        message: 'War Log is not public. So lets setup the roster!'
                    });
                    setupWarRosterForPrivateWarlog(auth, channelID, warSize);
                }
            });
        });
    });
}

function setupWarRosterForPublicWarlog(auth, channelID, clanTag) {
    if (!channelID) channelID = this.channelID;
    if (!clanTag) clanTag = this.clanTag;

    const sheets = google.sheets({version: 'v4', auth});

    var clanFamilyPrefs = getPreferencesFromChannel(channelID);
    if (clanFamilyPrefs == null) return unknownChannelMessage();
    var baseStatusColumn = clanFamilyPrefs.baseStatusColumn;
    var warsheet = clanFamilyPrefs.warsheet;
    var warSheetId = clanFamilyPrefs.sheetId;

    clashapi.getCurrentWar(clanTag, (err, currentWar) => {
        sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: [warsheet+'!A5:B'+MAX_ROWS]
        }, (err, res) => {
            var members = currentWar.opponent.members;
            var playerData = res.data.values;
            var rosterUpdate = [];
            var mapPositions = [];
            var attacks = [];
            var rowCount = 0;
            var warStartTime = moment(currentWar.startTime);
            playerData.forEach( playerRow => {
                if (playerRow.length > 0) {
                    playerTag = playerRow[1];
                    var mapPosition = "";
                    var memberIdx = -1;
                    for(var i=0; i<members.length; i++) {
                        if (members[i].tag == playerTag) {
                            mapPosition = members[i].mapPosition;
                            memberIdx = i;
                            break;
                        }  
                    }
                    if (memberIdx >= 0)
                        members.splice(memberIdx, 1); //Remove this member from list as he is already in roster.
                    if (mapPosition == "") attacks.push(["-","-"]);
                    else attacks.push(["XXX","XXX"]);
                    mapPositions.push([mapPosition]);
                    rowCount++;   
                }
            });
            
            rosterUpdate.push({range: clanFamilyPrefs.warsheet+'!C5:C'+(rowCount+5), values: mapPositions});
            rosterUpdate.push({range: clanFamilyPrefs.warsheet+'!G5:H'+(rowCount+5), values: attacks});
            rosterUpdate.push({range: CLAIMS+'!'+baseStatusColumn+'3', values: [[currentWar.startTime]]});

            //Now go through the remaining players (that are not in roster) and add them to roster.
            for(var i=0; i<members.length; i++) {
                rosterUpdate.push({range: clanFamilyPrefs.warsheet+'!B'+(rowCount+i+5), values: [[members[i].tag]]});
                rosterUpdate.push({range: clanFamilyPrefs.warsheet+'!C'+(rowCount+i+5), values: [[members[i].mapPosition]]});
                rosterUpdate.push({range: clanFamilyPrefs.warsheet+'!G'+(rowCount+i+5), values: [['XXX']]});
                rosterUpdate.push({range: clanFamilyPrefs.warsheet+'!H'+(rowCount+i+5), values: [['XXX']]});
            }
            rowCount = rowCount+members.length;
            
            sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    data: rosterUpdate,
                    valueInputOption: 'USER_ENTERED'
                }
            }, (err, result) => {
                if (err) {
                    logger.warn('The Google API returned an error: ' + err);
                    bot.sendMessage({
                        to: channelID,
                        message: 'Unable to complete the operation. Please try again later!'
                    });
                    return;
                }
                sheets.spreadsheets.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        requests: [{
                            "sortRange": {
                                "range": {
                                    "sheetId": warSheetId,
                                    "startColumnIndex": 0,
                                    "startRowIndex": 4,
                                    "endRowIndex": 4+rowCount
                                },
                                "sortSpecs": [{
                                    "dimensionIndex": 2,
                                    "sortOrder": "ASCENDING"
                                }]
                            }
                        }]
                    }
                }, (err, res) => {
                    if (err) {
                        logger.error(err);
                        bot.sendMessage({
                            to: channelID,
                            message: 'Unable to sort the sheet!'
                        });
                        return;
                    }
                    var duration = moment.duration(warStartTime.diff(moment()));
                    checkAndStartWarNotificationThread(auth, getClanTagFromChannel(channelID));
                    var startsIn = duration.hours() + "hrs " + duration.minutes() + "mins ";
                    bot.sendMessage({
                        to: channelID,
                        message: 'Done! War starts in '+startsIn+'. Good luck!'
                    });
                });
            });
        }); 

    });
}

function setupWarRosterForPrivateWarlog(auth, channelID, rosterSize) {
    if (!rosterSize && !this.args) rosterSize = 40;
    if (this.args && this.args.length > 0) rosterSize = parseInt(this.args[0]);
    if (this.channelID) channelID = this.channelID;

    var thisClanTag = getClanTagFromChannel(channelID);
    var clanFamilyPrefs = getPreferencesFromChannel(channelID);

    const sheets = google.sheets({version: 'v4', auth});

    where = {clan: thisClanTag, inClan: true};
    models.PlayerData.findAll({ 
        where: where,
        order: [
            ['townhallLevel', 'DESC']
        ]
    }).then(clanMembers => {
        logger.info("Found " + clanMembers.length + " Members in clan.");
        sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: clanFamilyPrefs.warsheet +'!B5:C' + MAX_ROWS,
        }, (err, res) => {
            if (err) {
                logger.warn('The Google API returned an error: ' + err);
                bot.sendMessage({
                    to: channelID,
                    message: 'Unable to fetch information. Try again later!'
                });
                return;
            }
            var previousWarData = res.data.values;
            var message = "";
            var idx = 1;
            var count = 0;
            var rosterMembers = [];

            clanMembers.forEach(member => {
                var idx = search2D(previousWarData, 0, member.tag);
                var inWar = false;
                //Checking if the player was in Previous War.. if so we include him
                if (idx > -1 && previousWarData[idx].length > 1 && previousWarData[idx][1]!="")
                    inWar = true;
                rosterMembers.push({name: member.name, 
                                    townhallLevel: member.townhallLevel, 
                                    inc: inWar, 
                                    tag: member.tag});
                idx++;
            });
            bot.sendMessage({
                to: channelID,
                message: constructRosterMessage(rosterMembers, rosterSize)
            }, (err, response) => {
                startWarRosterThread(auth, response.id, channelID, rosterMembers, rosterSize);
            });
        });
    });
}

const rosterNegotiations = {};

function startWarRosterThread(auth, messageID, channelID, rosterMembers, rosterSize) {
    if (Object.keys(rosterNegotiations).includes(channelID)) {

    } else {
        rosterNegotiations[channelID] = {
            inProgress : true, 
            messageID: messageID, 
            members: rosterMembers,
            rosterSize: rosterSize,
        };
    }
}

function confirmRoster(auth) {
    var channelID = this.channelID;
    var negotiation = rosterNegotiations[channelID];
    if (negotiation == null) {
        bot.sendMessage({
            to: channelID,
            message: "No roster to confirm."
        });
        return;
    }
    var totalCount = 0;
    negotiation.members.forEach( member => {
        if (member.inc) totalCount++;
    });
    if (totalCount != negotiation.rosterSize) {
        bot.sendMessage({
            to: channelID,
            message: "Roster size: " + negotiation.rosterSize + "; Opted in: " + totalCount + ". Needs some edits!"
        });
        return;
    }
    bot.simulateTyping(channelID);
    const sheets = google.sheets({version: 'v4', auth});
    var clanFamilyPrefs = getPreferencesFromChannel(channelID);
    if (clanFamilyPrefs == null) unknownChannelMessage(channelID);

    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: clanFamilyPrefs.warsheet +'!B5:B' + MAX_ROWS,
    }, (err, res) => {
        if (err) {
            logger.warn('The Google API returned an error: ' + err);
            bot.sendMessage({
                to: channelID,
                message: 'Unable to complete the operation. Please try again later!'
            });                
            return;
        }
        var playerTags = res.data.values;
        var newPlayerIdx = 0;
        for(;newPlayerIdx<playerTags.length; newPlayerIdx++) {
            if (playerTags && playerTags[newPlayerIdx] && playerTags[newPlayerIdx][0])
                continue;
            else
                break;
        }
        var updateData = [];
        var idx = 1;
        var modifiedPlayerTags = [];
        negotiation.members.forEach( member => {
            var rosterIdx = search2D(playerTags, 0, member.tag);
            modifiedPlayerTags.push(member.tag);
            if (member.inc) {
                if (rosterIdx == -1) {
                    rosterIdx = newPlayerIdx;
                    newPlayerIdx++;
                    updateData.push({range: clanFamilyPrefs.warsheet+'!B'+(rosterIdx+5), values: [[member.tag]]});
                }
                updateData.push({range: clanFamilyPrefs.warsheet+'!C'+(rosterIdx+5), values: [[""+idx]]});
                updateData.push({range: clanFamilyPrefs.warsheet+'!G'+(rosterIdx+5), values: [["XXX"]]});
                updateData.push({range: clanFamilyPrefs.warsheet+'!H'+(rosterIdx+5), values: [["XXX"]]});
                idx++;
            } else if (rosterIdx > -1) {
                updateData.push({range: clanFamilyPrefs.warsheet+'!C'+(rosterIdx+5), values: [[""]]});
                updateData.push({range: clanFamilyPrefs.warsheet+'!G'+(rosterIdx+5), values: [["-"]]});
                updateData.push({range: clanFamilyPrefs.warsheet+'!H'+(rosterIdx+5), values: [["-"]]});
            }
        });
        for(var i=0; i<playerTags.length; i++) {
            if (playerTags[i] && playerTags[i][0]) {
                var playerTag = playerTags[i][0];
                if (!modifiedPlayerTags.includes(playerTag)) {
                    updateData.push({range: clanFamilyPrefs.warsheet+'!C'+(i+5), values: [[""]]});
                    updateData.push({range: clanFamilyPrefs.warsheet+'!G'+(i+5), values: [["-"]]});
                    updateData.push({range: clanFamilyPrefs.warsheet+'!H'+(i+5), values: [["-"]]});
                }
            }
        }
        sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                data: updateData,
                valueInputOption: 'USER_ENTERED'
            }
        }, (err, result) => {
            sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                resource: {
                    requests: [{
                        "sortRange": {
                            "range": {
                                "sheetId": clanFamilyPrefs.sheetId,
                                "startColumnIndex": 0,
                                "startRowIndex": 4,
                                "endRowIndex": 4+newPlayerIdx
                            },
                            "sortSpecs": [{
                                "dimensionIndex": 2,
                                "sortOrder": "ASCENDING"
                            }]
                        }
                    }]
                }
            }, (err, res) => {
                if (err) {
                    logger.error(err);
                    bot.sendMessage({
                        to: channelID,
                        message: 'Unable to sort the sheet!'
                    });
                    return;
                }
                rosterNegotiations[channelID] = null;
                bot.sendMessage({
                    to: channelID,
                    message: 'Ok, Roster locked down. Good luck in War!'
                });
                checkAndStartWarNotificationThread(auth, getClanTagFromChannel(channelID));
            });
        });
    });
}

function updateRoster(auth) {
    var channelID = this.channelID;
    var messageID = this.messageID;
    var args = this.args;
    var inc = this.inc;
    var negotiation = rosterNegotiations[channelID];
    var inIndices = [];
    const sheets = google.sheets({version: 'v4', auth});

    if (negotiation == null) {
        bot.sendMessage({
            to: channelID,
            message: "War roster locked down. Please check with an Officer."
        });
        return;
    }

    if (args.length <= 2 && isNaN(parseInt(args[0]))) {
        //This probably is a player instead of index.
        var rosterIdx = 0;
        if (args.length > 1) {
            rosterIdx = parseInt(args[1]);
            if (isNaN(rosterIdx)) {
                bot.sendMessage({
                    to: channelID,
                    message: "To add a player: !in <playername> <index - position in roster>"
                })
                return;
            }
        } else {
            bot.sendMessage({
                to: channelID,
                message: "To add a player: !in <playername> <index>"
            })
            return;
        }
        sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: MASTER_ROSTER_SHEET +'!A2:E' + MAX_ROWS,
        }, (err, res) => {
            var playerData = res.data.values;
            var idx = search2D(playerData, 1, args[0]);
            if (idx != -1) {
                negotiation.members.splice(rosterIdx, 0, {
                    name: playerData[idx][1], 
                    townhallLevel: playerData[idx][4], 
                    inc: true, 
                    tag: playerData[idx][0],
                    new: true,
                });
            }
            _updateRosterAsync(channelID, messageID, negotiation, inIndices, inc);
        });
    } else {
        args.forEach( idxStr => {
            var parsed = parseInt(idxStr);
            if (!isNaN(parsed))
                inIndices.push(parsed);
        });
        _updateRosterAsync(channelID, messageID, negotiation, inIndices, inc);
    }

}

function _updateRosterAsync(channelID, messageID, negotiation, inIndices, inc) {
    
    inIndices.forEach( index => {
        if (index > 0 && index <= negotiation.members.length+1)
            negotiation.members[index-1].inc = inc;
    });
    bot.editMessage({
        channelID: channelID,
        messageID: negotiation.messageID,
        message: constructRosterMessage(negotiation.members, negotiation.rosterSize)
    }, (err, response) => {
        bot.deleteMessage({
            channelID: channelID,
            messageID: messageID
        });
    });    
}

function constructRosterMessage(rosterMembers, rosterSize) {
    var message = [];
    var idx = 1;
    var count = 0;
    var midpoint = Math.ceil(rosterMembers.length/2);

    for(var i=0; i<rosterMembers.length; i++) {
        var memberStr= "";
        var member = rosterMembers[i];
        idx = i+1;
        memberStr += (idx) + ". " + ((idx < 10) ? " " : "");
        memberStr += (member.inc) ? "✅ " : "❌ ";  // ❌ ❎  
        var memberDisplayStr = member.name + " (TH" + member.townhallLevel + ")";
        while (memberDisplayStr.length <= 23)
            memberDisplayStr+= " ";
        memberStr += memberDisplayStr;
        if (idx > midpoint) {
            message[idx - midpoint -1] += " " + memberStr 
        } else {
            message.push( memberStr );
        }
        if (member.inc) count++;
    }
    var format = (count==rosterSize) ? 'CSS' : 'diff';
    var finalMessage = "```" + format + "\n- Opted in: " + count + "````" + message.join("`\n`") + "`\n```" + format + "\n- Opted in: " + count + "```";
    logger.debug(finalMessage);
    return finalMessage;
}

function endwar(auth) {
    const channelID = this.channelID;
    const sheets = google.sheets({version: 'v4', auth});
    var args = this.args;
    var finalScore = args.pop();
    var result = args.pop();
 
    var clanFamilyPrefs = getPreferencesFromChannel(channelID);
    if (clanFamilyPrefs == null) {
        unknownChannelMessage(channelID);
        return;
    }
    
    var warsheet = clanFamilyPrefs.warsheet;
    var sheetId = clanFamilyPrefs.sheetId;

    sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        ranges:[ warsheet+'!G1:G4', warsheet+'!A2'],
        includeGridData: true
    }, (err, res) => {
        var lastWarLog = res.data.sheets[0].data[0].rowData;
        var warStats = res.data.sheets[0].data[1].rowData.values[0].formattedValue;
        
        var clanTagCell = lastWarLog[1].values[0];
        var lastOpponentTag = "";
        var lastOpponent = "";
        var lastWarDate = "";
        if ("formattedValue" in clanTagCell) {
            lastOpponentTag = clanTagCell.formattedValue;
            lastOpponent = lastWarLog[0].values[0].formattedValue;
            lastWarDate = lastWarLog[3].values[0].formattedValue;
        }

        var backgroundColor = clanTagCell.effectiveFormat.backgroundColor;
        if (backgroundColor.red != 1) {
            bot.sendMessage({
                to: channelID,
                message: "War with **" + lastOpponent + "** *(" + lastOpponentTag + ")* has already ended."
            });
            return;
        }
        
        var bgColor = WIN_COLOR;
        if (result.toUpperCase() == "L" || result.toUpperCase() == "LOSS")
            bgColor = LOSS_COLOR;
        var endWarReq = {
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                requests: [{
                    "updateCells": {
                        "rows": [{
                            "values": [{
                                "userEnteredValue": {
                                    "stringValue": lastOpponent
                                },
                                "userEnteredFormat": {
                                    "backgroundColor": bgColor
                                }
                            }]
                        },{
                            "values": [{
                                "userEnteredValue": {
                                    "stringValue": lastOpponentTag
                                },
                                "userEnteredFormat": {
                                    "backgroundColor": bgColor
                                }
                            }]
                        },{
                            "values": [{
                                "userEnteredValue": {
                                    "stringValue": finalScore
                                },
                                "userEnteredFormat": {
                                    "backgroundColor": bgColor
                                }
                            }]
                        },{
                            "values": [{
                                "userEnteredValue": {
                                    "stringValue": lastWarDate
                                },
                                "userEnteredFormat": {
                                    "backgroundColor": bgColor
                                }
                            }]
                        }],
                        "fields": "userEnteredFormat/backgroundColor,userEnteredValue/stringValue",
                        "range": {
                            "sheetId": sheetId,
                            "startRowIndex": 0,
                            "startColumnIndex": 6,
                            "endRowIndex": 4,
                            "endColumnIndex": 7
                        }
                    }
                }],
            }
        };
        sheets.spreadsheets.batchUpdate(endWarReq, (err, res)=> {
            if (err) {
                bot.sendMessage({
                    to: channelID,
                    message: "Something went wrong... Sorry!"
                });
                logger.error(err);
                return;
            }
            bot.sendMessage({
                to: channelID,
                message: "Done"
            })
        });

    });
}

function link(auth) {
    const channelID = this.channelID;
    var args = this.args;

    if (args.length < 2) {
        bot.sendMessage({
            to: channelID,
            message: 'Insufficient information provided. \nUsage: !link <player name or player tag> @<discord name>'
        });
        return;
    }

    var playerDiscordId = args.pop().split('@')[1].replace('>', '');
    if (playerDiscordId.startsWith('!'))
        playerDiscordId = playerDiscordId.replace('!', '');
    const playerName = args.join(' ');
    const sheets = google.sheets({version: 'v4', auth});

    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: MASTER_ROSTER_SHEET +'!A2:D' + MAX_ROWS,
    }, (err, res) => {
        var newAddition = false;
        if (err) {
            logger.warn('The Google API returned an error: ' + err);
            bot.sendMessage({
                to: channelID,
                message: 'Unable to fetch information. Try again later!'
            });
            return;
        }
        var playersData = res.data.values;
        var idx = -1;
        if (playerName.startsWith('#')) {
            idx = search2D(playersData, 0, playerName);
        } else {
            idx = search2D(playersData, 1, playerName);
        }
        if (idx == -1) {
            //Need to add this player as he is not in the spreadsheet yet.
            var i=0
            newAddition = true;
            for(;i<playersData.length; i++) {
                if (playersData && playersData[i] && playersData[i][0])
                    continue;
                else
                    break;
            }
            idx = i;
        } else {
            if (playersData[idx][3]) {
                bot.sendMessage({
                    to: channelID,
                    message: '' + playerName + ' is already linked to a Discord Id.'
                });
                return;
            }
        }
        //Need to update discord id of this player.
        data: [{
                    range: clanFamilyPrefs.warsheet+'!E'+idx,
                    values: [['']]
                }, {
                    range: CLAIMS + '!A'+idx,
                    values: [[moment(new Date()).tz('America/New_York').format('YYYY/M/D HH:mm:s')]]
                }]
        data = [];
        if (playerName.startsWith('#'))
            data.push({range: MASTER_ROSTER_SHEET+'!A'+(idx+2), values: [[playerName]]});
        else 
            data.push({range: MASTER_ROSTER_SHEET+'!B'+(idx+2), values: [[playerName]]});
        data.push({range: MASTER_ROSTER_SHEET+'!D'+(idx+2), values: [[playerDiscordId]]});

        sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                data: data,
                valueInputOption: 'USER_ENTERED'
            }
        }, (err, result) => {
            if (err) {
                logger.warn('The Google API returned an error: ' + err);
                bot.sendMessage({
                    to: channelID,
                    message: 'Unable to complete the operation. Please try again later!'
                });
                return;
            }
            bot.sendMessage({
                to: channelID,
                message: 'Done!'
            });
        });
    });
}

function notify(auth) {
    const channelID = this.channelID;
    const sheets = google.sheets({version: 'v4', auth});
    const clanFamilyPrefs = getPreferencesFromChannel(channelID);
    const warsheet = clanFamilyPrefs.warsheet;

    if (clanFamilyPrefs.cwlInterval) {
        var sRow = clanFamilyPrefs.cwlWarTagRow+2;
        var eRow = clanFamilyPrefs.cwlWarTagRow+25;
        var round = clanFamilyPrefs.round;
        sheets.spreadsheets.values.batchGet({
            spreadsheetId: SPREADSHEET_ID,
            ranges: [
                'CWL!B'+sRow + ':B'+eRow,
                'CWL!E'+sRow + ':E'+eRow,
                'CWL!' + String.fromCharCode(69+round) +  sRow + ':' + String.fromCharCode(69+round) + eRow,
                ROSTER+'!A2:A'+MAX_ROWS,
                ROSTER+'!B2:B'+MAX_ROWS,
                ROSTER+'!D2:D'+MAX_ROWS,
                ROSTER+'!H2:H'+MAX_ROWS,
            ]
        }, (err, res) => {
            _notify(err, res, channelID, clanFamilyPrefs, true);
        });
    } else {
        sheets.spreadsheets.values.batchGet({
            spreadsheetId: SPREADSHEET_ID,
            ranges: [
                warsheet+'!B5:B'+MAX_ROWS,
                warsheet+'!E5:E'+MAX_ROWS, 
                warsheet+'!G5:H'+MAX_ROWS,
                ROSTER+'!A2:A'+MAX_ROWS,
                ROSTER+'!B2:B'+MAX_ROWS,
                ROSTER+'!D2:D'+MAX_ROWS,
                ROSTER+'!H2:H'+MAX_ROWS,
            ]
        }, (err, res) => {
            _notify(err, res, channelID, clanFamilyPrefs, false);
        });        
    }
}

function _notify(err, res, channelID, clanFamilyPrefs, cwl) { 
    if (err) {
        logger.warn('The Google API returned an error: ' + err);
        bot.sendMessage({
            to: channelID,
            message: 'Unable to fetch information. Try again later!'
        });
        return;
    }
    const playerTags = res.data.valueRanges[0].values;
    const claims = res.data.valueRanges[1].values;
    const warlog = res.data.valueRanges[2].values;
    const rosterPlayerTags = res.data.valueRanges[3].values;
    const rosterNames = res.data.valueRanges[4].values;
    const rosterDiscordIds = res.data.valueRanges[5].values;
    const rosterNotifExclOption = res.data.valueRanges[6].values;
    const playerTagDiscordIdsMap = {};
    const playerTagNameMap = {};
    //Build a set of names who wont get notifications.
    for (var i=0; i<rosterPlayerTags.length; i++) {
        var rosterPlayerTag = rosterPlayerTags[i][0];
        
        if (rosterNotifExclOption.length>i &&
            rosterNotifExclOption[i] &&
            rosterNotifExclOption[i].length>0 &&
            rosterNotifExclOption[i][0] == 'X') {
            //Dont add the mapping to discord id.
        } else {
            if (rosterDiscordIds[i] && rosterDiscordIds[i].length>0 && rosterDiscordIds[i][0]!="")
                playerTagDiscordIdsMap[rosterPlayerTag] = rosterDiscordIds[i][0];
            playerTagNameMap[rosterPlayerTag] = rosterNames[i][0];
        }
    }

    var twoAttacksRemainingList = [];
    var oneAttackRemainingList = [];

    for(var i=0; i<warlog.length; i++) {
        if (i<playerTags.length && playerTags[i] && playerTags[i][0] && playerTags[i][0]!="") {
            //Continue with process. Else we reached end for this clan. Break out.
        } else {
            break;
        }
        var playerTag = playerTags[i][0];
        if (!(playerTag in playerTagDiscordIdsMap)) {
            continue;
        }

        var attacksRemainingForThisPlayer = 0;
        if (cwl) {
            if (warlog[i][0] == 'Q')  attacksRemainingForThisPlayer++;
        } else {
            if (warlog[i][0] == 'XXX') attacksRemainingForThisPlayer++;
            if (warlog[i][1] == 'XXX') attacksRemainingForThisPlayer++;            
        }

        if (attacksRemainingForThisPlayer > 1)
            twoAttacksRemainingList.push([playerTagDiscordIdsMap[playerTag], playerTagNameMap[playerTag]]);
        else if (attacksRemainingForThisPlayer > 0) 
            oneAttackRemainingList.push([playerTagDiscordIdsMap[playerTag], playerTagNameMap[playerTag]]);
    }

    if (twoAttacksRemainingList.length > 0) {
        var message = '';
        twoAttacksRemainingList.forEach( element => {
            if ( element[0] && element[0] !='' )
                message += ' <' + '@' + element[0] + '> ' + element[1];
        })
        if (message.length > 1) {
            message += ' have 2 attacks left in war. Always get both your attacks in.';
            bot.sendMessage({
                to: channelID,
                message: message
            });
        }
    }
    if (oneAttackRemainingList.length > 0) {
        var message = '';
        oneAttackRemainingList.forEach( element => {
            if ( element[0] && element[0] !='' )
                message += ' <' + '@' + element[0] + '> ' + element[1];
        })
        if (cwl) {
            message += ' You still have not attacked on CWL Day-' + clanFamilyPrefs.round + '. Dont forget to use your attacks.'
        } else 
            message += ' You have 1 attack left. Don\'t forget to always use both attacks.';
        bot.sendMessage({
            to: channelID,
            message: message
        });
    }
}

function roster(auth) {
    const channelID = this.channelID;
    const detail = this.detail;
    const sheets = google.sheets({version: 'v4', auth});
    const clanFamilyPrefs = getPreferencesFromChannel(channelID);
    if (clanFamilyPrefs == null) {
        unknownChannelMessage(channelID);
        return;
    }

    const warsheet = clanFamilyPrefs.warsheet;
    const baseStatusColumn = clanFamilyPrefs.baseStatusColumn;
    const basesAttackedColumn = clanFamilyPrefs.basesAttackedColumn;

    sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [warsheet+'!A5:A'+MAX_ROWS, 
                 warsheet+'!G5:H'+MAX_ROWS, 
                 'CLAIMS!'+ baseStatusColumn + '2',
                 'CLAIMS!'+basesAttackedColumn+'5:'+basesAttackedColumn+MAX_ROWS]
    }, (err, res) => { 
        const playerNames = res.data.valueRanges[0].values;
        const warlog = res.data.valueRanges[1].values;
        const opponentLog = res.data.valueRanges[2].values;
        const warSize = res.data.valueRanges[3].values[0][0];
        var attacksRemainingCount = 0;
        var attacksRemaining = '';

    });
}

/**
 * Reads the AlmostDivorced Google Spreadsheet and get the war attacks data
 * SheetID:  1kEDgi1r2D32Z1G9wRCx8KL89Rt6c5aAh8rvD_nLkNDQ
 * @see https://docs.google.com/spreadsheets/d/1kEDgi1r2D32Z1G9wRCx8KL89Rt6c5aAh8rvD_nLkNDQ/edit
 * @param {google.auth.OAuth2} auth The authenticated Google OAuth client.
 */
function summary(auth) {
    const channelID = this.channelID;
    const detail = this.detail;
    const sheets = google.sheets({version: 'v4', auth});
    const clanFamilyPrefs = getPreferencesFromChannel(channelID);
    if (clanFamilyPrefs == null) {
        unknownChannelMessage(channelID);
        return;
    }
    if (clanFamilyPrefs.cwlInterval) {
        cwlSummary(auth, channelID, clanFamilyPrefs, detail);
        return;
    }
    const warsheet = clanFamilyPrefs.warsheet;
    const baseStatusColumn = clanFamilyPrefs.baseStatusColumn;

    sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [
            warsheet+'!A5:A'+MAX_ROWS, 
            warsheet+'!G5:H'+MAX_ROWS, 
            CLAIMS+'!'+baseStatusColumn+'4:'+baseStatusColumn+'54', 
            CLAIMS+'!'+baseStatusColumn+'2',
            CLAIMS+'!'+baseStatusColumn+'3',
        ]
    }, (err, res) => { 
        if (err) {
            logger.warn('The Google API returned an error: ' + err);
            bot.sendMessage({
                to: channelID,
                message: 'Unable to fetch information. Try again later!'
            });
            return;
        }
        const playerNames = res.data.valueRanges[0].values;
        const warlog = res.data.valueRanges[1].values;
        const opponentLog = res.data.valueRanges[2].values;
        const warSize = res.data.valueRanges[3].values[0][0];
        const warStartTimeStr = res.data.valueRanges[4].values[0][0];
        const warStartTime = moment(warStartTimeStr, 'YYYYMMDDTHHmmss.SSSZ');
        var attacksRemainingCount = 0;
        var attacksRemaining = '';
        if (warlog) {
            for(var i=0; i<warlog.length; i++) {
                var attacksRemainingForThisPlayer = '';
                if (warlog[i][0] == 'XXX') attacksRemainingForThisPlayer += '⚔ '; 
                if (warlog[i][1] == 'XXX') attacksRemainingForThisPlayer += '⚔ ';
                attacksRemainingCount += (attacksRemainingForThisPlayer.length)/2;
                if (attacksRemainingForThisPlayer.length > 0 && playerNames[i]) {
                    attacksRemaining += ' '; 
                    for (var j=0;j<(17-playerNames[i][0].length); j++) {
                        attacksRemaining += ' ';
                    }
                    attacksRemaining += playerNames[i][0] + '  -  ' + attacksRemainingForThisPlayer + '\n';
                }
            } 
        } else {
            bot.sendMessage({
                to: channelID,
                message: 'Not in war right now!'
            });
            return;
        }
        attacksRemaining = '```fix\nAttacks Remaining: ' + attacksRemainingCount + '       \n\n' + attacksRemaining + '```';
        var basesRemaining = '';
        var duration = warStartTime.diff(moment(), 'milliseconds');
        if (opponentLog) {
            for(var i=0; i<warSize; i++) {
                var baseStr = (i<=8) ? '     '+(i+1) : '    '+(i+1);
                if (opponentLog[i] && opponentLog[i][0]) {
                    if (opponentLog[i][0] != 3) {
                        basesRemaining += '' + baseStr + '  -  ';
                        for(var k=0; k<opponentLog[i][0]; k++) {
                            basesRemaining += STAR_FULL;
                        }
                        basesRemaining += '\n';
                    }
                } else {
                    basesRemaining += '' + baseStr + '  -  None\n';
                }
            }
            if (basesRemaining == '') basesRemaining = "All bases are 3 starred!"
        } else {
            if (duration > 0) {
                var mDuration = moment.duration(warStartTime.diff(moment()));
                basesRemaining = 'War starts in ' + mDuration.hours() + 'hrs ' + mDuration.minutes() + 'mins.';
            } else {
                basesRemaining = 'All bases are open!'
            }
        }
        if (!detail)
            attacksRemaining = '';
        if (duration < 0) {
            warStartTime.add(24, 'hours');
            var mDuration = moment.duration(warStartTime.diff(moment()));
            basesRemaining = 'War ends in ' + mDuration.hours() + 'hrs ' + mDuration.minutes() + 'mins.\n\n' + basesRemaining;
        }
        bot.sendMessage({
            to: channelID,
            embed: {
                color: 13683174,
                description: '```fix\nAttacks Remaining: ' + attacksRemainingCount + '\n\n' + basesRemaining + '\n```\n' + attacksRemaining + '',
                footer: { 
                    text: ''
                },
                thumbnail: {
                    url: ''
                },
                title: 'War Summary',
                url: ''
              }
        });
    });
}

function cwlSummary(auth, channelID, clanFamilyPrefs, detail) {
    const sheets = google.sheets({version: 'v4', auth});
    const sRow = clanFamilyPrefs.cwlWarTagRow-1;
    const eRow = clanFamilyPrefs.cwlWarTagRow+27;
    const round = clanFamilyPrefs.round;
    const baseStatusColumn = clanFamilyPrefs.baseStatusColumn;

    sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [
            'CWL!C'+sRow + ':L'+eRow ,
            CLAIMS+'!'+baseStatusColumn+'3',
        ]
    }, (err, res) => {
        var sheetData = res.data.valueRanges[0].values;
        const warStartTimeStr = res.data.valueRanges[1].values[0][0];
        const warStartTime = moment(warStartTimeStr, 'YYYYMMDDTHHmmss.SSSZ');
        warStartTime.add(24, 'hours');
        var mDuration = moment.duration(warStartTime.diff(moment()));

        var totalStars = 0;
        var attacksRemaining = 0;
        var message = '';
        for(var i=3; i<sheetData.length; i++) {
            if (sheetData[i] && sheetData[i].length>0 && sheetData[i][0] && sheetData[i][0]!='') {
                var score = sheetData[i][2+round];
                var name = sheetData[i][0];
                if (score == '-') continue; //Not in this war. (spectator)

                while (name.length < 20) name += ' ';
                message += name + ' -  ';
                if (score == 'Q') {
                    attacksRemaining++;
                    message +=  'Pending';
                } else {
                    var iScore = parseInt(score);
                    totalStars += iScore;
                    var stars = '';
                    while(iScore > 0) {
                        stars += STAR_FULL;
                        iScore--;
                    }
                    while(stars.length == 0) stars = '⭕';
                    message += stars;
                }
                message += '\n';
            } else {
                break;
            }
        }
        var finalMessage = '```fix\nCWL Day - ' + round + ' (' + sheetData[0][2+round] + ')\n\n';
        finalMessage += 'Attacks Remaining: ' + attacksRemaining + '\n\n';
        finalMessage += 'War ends in ' + mDuration.hours() + 'hrs ' + mDuration.minutes() + 'mins.\n\n';
        finalMessage += message + '\nScore: ' + totalStars + '```';
        bot.sendMessage({
            to: channelID,
            embed: {
                color: 13683174,
                description: finalMessage,
                footer: { 
                    text: ''
                },
                thumbnail: {
                    url: ''
                },
                title: 'CWL War Summary',
                url: ''
            }
        })
    });
}

function attack(auth) {
    const channelID = this.channelID;
    const clanFamilyPrefs = getPreferencesFromChannel(channelID);

    if (clanFamilyPrefs == null) {
        unknownChannelMessage(channelID);
        return;
    }

    var args = this.args;
    if (args.length < 2) {
        bot.sendMessage({
            to: channelID,
            message: 'Who attacked which base and for how many stars?'
        });
        return;
    }
    const sheets = google.sheets({version: 'v4', auth});
    var stars = parseInt(args.pop());
    var attackedBaseNumber = parseInt(args.pop());
    var attacker = args.join(' ');
    const warsheet = clanFamilyPrefs.warsheet;
    const baseStatusColumn = clanFamilyPrefs.baseStatusColumn;
    const basesAttackedColumn = clanFamilyPrefs.basesAttackedColumn;

    sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [warsheet+'!A5:A'+MAX_ROWS, warsheet+'!D5:D'+MAX_ROWS, 
                 warsheet+'!E5:E'+MAX_ROWS, warsheet+'!G5:H'+MAX_ROWS, 
                 'CLAIMS!'+baseStatusColumn+'4:'+baseStatusColumn+'54',
                 'CLAIMS!'+basesAttackedColumn+'5:'+basesAttackedColumn+MAX_ROWS]
    }, (err, res) => { 
        if (err) {
            logger.warn('The Google API returned an error: ' + err);
            bot.sendMessage({
                to: channelID,
                message: 'Unable to fetch information. Try again later!'
            });
            return;
        }
        const playerNames = res.data.valueRanges[0].values;
        const playerDiscordIds = res.data.valueRanges[1].values;
        const playerClaims = res.data.valueRanges[2].values;
        const attackLog = res.data.valueRanges[3].values;
        const baseStatus = res.data.valueRanges[4].values;
        const basesAttacked = res.data.valueRanges[5].values;
        var firstAttack = true;
        let playerIdx = -1;
        if (attacker == '')
            playerIdx = search2D(playerClaims, 0, ''+attackedBaseNumber);
        else  
            playerIdx = search2D(playerNames, 0, attacker);
        
        if (playerIdx == -1) {
            bot.sendMessage({
                to: channelID,
                message: 'Yo couldn\'t locate player - \'' + attacker + '\'. Please try again!'
            });
            return;
        }
        basesAttackedByPlayer = [];
        if (basesAttacked && basesAttacked[playerIdx] && basesAttacked[playerIdx][0])
            basesAttackedByPlayer = basesAttacked[playerIdx][0].split(',');

        if (basesAttackedByPlayer.includes(""+attackedBaseNumber)) {
            logger.info("Already recorded the attack. Ignoring command.");
            bot.sendMessage({
                to: channelID,
                message: 'I knew that already!'
            });
            return;
        }
        if (basesAttackedByPlayer.length >= 2) {
            bot.sendMessage({
                to: channelID,
                message: 'Both attacks recorded already! This seems to be third attack ???'
            });
            return;
        }
        basesAttackedByPlayer.push(""+attackedBaseNumber);
        var data = [];

        if (baseStatus && baseStatus[attackedBaseNumber-1] && (''+baseStatus[attackedBaseNumber-1][0] != '3')) {
            //This is to record the current number of stars on a base. If already 3 starred, then no need to update.
            data.push([{range: CLAIMS+'!'+baseStatusColumn+(attackedBaseNumber+3), values: [[stars]]}]); 
        } else if (!baseStatus || !baseStatus[attackedBaseNumber]) {
            data.push([{range: CLAIMS+'!'+baseStatusColumn+(attackedBaseNumber+3), values: [[stars]]}]); 
        }
        
        if (playerIdx != -1) {
            if (attackLog[playerIdx][0] != 'XXX')
                firstAttack = false;
            if (playerClaims && playerClaims[playerIdx] && playerClaims[playerIdx][0] == attackedBaseNumber) {
                if (stars == 3)
                    bot.sendMessage({
                        to: channelID,
                        message: '<@' + playerDiscordIds[playerIdx][0] + '> Goodjob by ' + playerNames[playerIdx][0] + ' on #' + attackedBaseNumber + '!'
                    });
                else 
                    bot.sendMessage({
                        to: channelID,
                        message: '<@' + playerDiscordIds[playerIdx][0] + '> Tough break on #' + attackedBaseNumber + '! Better luck next time!'
                    });
            } else {
                bot.sendMessage({
                    to: channelID,
                    message: 'Ok!'
                });
            }
            //This is removing the Claim. (Claim column)
            data.push({range: warsheet+'!E'+(playerIdx+5),values: [['']]});
            //This is the attack record (could be col G or H.)
            data.push({range: warsheet+'!'+(firstAttack?'G':'H')+(playerIdx+5),values: [[stars]]});
            //This is to record which bases the player has attacked.
            data.push({range: CLAIMS+'!'+basesAttackedColumn+(playerIdx+5), values: [[basesAttackedByPlayer.join(',')]]});
            //This is to update the claim timestamp
            data.push({range: CLAIMS+'!A'+(playerIdx+5),values: [[moment(new Date()).tz('America/New_York').format('YYYY/M/D HH:mm:s')]]});
        } else {
            bot.sendMessage({
                to: channelID,
                message: 'Ok!'
            });
        }
        sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                data: data,
                valueInputOption: 'USER_ENTERED'
            }
        }, (err, result) => {
            if (err) {
                logger.error('Error while updating war log! ' + err);
                bot.sendMessage({
                    to: channelID,
                    message: 'Ugh... Something weird happened. Couldn\'t update war log'
                });
                return;
            }
        });
    });
}

function unclaim(auth) {
    const channelID = this.channelID;
    const args = this.args;
    var clanFamilyPrefs = getPreferencesFromChannel(channelID);
    var warsheet = clanFamilyPrefs.warsheet;

    const sheets = google.sheets({version: 'v4', auth});
    const values = [];
    if (args.length == 0) {
        bot.sendMessage({
            to: channelID,
            message: 'What to unclaim?'
        });
        return;
    }
    var target = undefined;
    var attacker = args.join(' ');
    var lastArg = args.pop();
    if (!Number.isNaN(parseInt(lastArg))) {
        target = ""+parseInt(lastArg);
    } else {
        if (lastArg.startsWith('#')) {
            lastArg = lastArg.substring(1);
            if (!Number.isNaN(parseInt(lastArg))) {
                target = ""+parseInt(lastArg);
            }
        }
    }

    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: warsheet+'!A5:H54',
    }, (err, res) => { 
        if (err) {
            logger.warn('The Google API returned an error: ' + err);
            bot.sendMessage({
                to: channelID,
                message: 'Unable to fetch information. Try again later!'
            });
            return;
        }
        const rows = res.data.values;
        let idx = -1;
        if (target != undefined) {
            idx = search2D(rows, 4, target);
            if (idx < 0) {
                bot.sendMessage({
                    to: channelID,
                    message: 'I don\'t think anybody claimed the target \'' + target + '\'.'
                });
                return;
            }
        } else {
            idx = search2D(rows, 0, attacker);
            if (idx == -1) {
                bot.sendMessage({
                    to: channelID,
                    message: 'Yo! Couldn\'t locate player - \'' + attacker + '\'. Check '
                });
                return;
            }
        }

        target = rows[idx][4];
        idx += 5;        
        var now = new Date();
        var date_str = now.toLocaleDateString('en-US', {timeZone: 'America/New_York'});
        date_str += ' ' + now.toLocaleTimeString('en-US', {timeZone: 'America/New_York'});

        sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                data: [{
                    range: warsheet+'!E'+idx,
                    values: [['']]
                }, {
                    range: CLAIMS+'!A'+idx,
                    values: [[moment(new Date()).tz('America/New_York').format('YYYY/M/D HH:mm:s')]]
                }],
                valueInputOption: 'USER_ENTERED'
            }
        }, (err, result) => {
            if (err) {
                logger.error('Error while updating claim! ' + err);
                bot.sendMessage({
                    to: channelID,
                    message: 'Ugh... Something weird happened. Couldnt remove your claim!'
                });
                return;
            } else {
                bot.sendMessage({
                    to: channelID,
                    message: 'Ok. Removed ' + rows[idx-5][0] + '\'s claim on \'#' + target + '\'!'
                });
            }
        });
    });
}



function claim(auth) {
    const channelID = this.channelID;
    const clanFamilyPrefs = getPreferencesFromChannel(channelID);
    if (clanFamilyPrefs == null) {
        unknownChannelMessage(channelID);
        return ;
    }

    const args = this.args;
    if (args.length < 2) {
        bot.sendMessage({
            to: channelID,
            message: 'Come on! How do you expect me to decode that information?'
        });
        return;
    }
    const target = args.pop();
    const attacker = args.join(' ');
    const sheets = google.sheets({version: 'v4', auth});

    if (clanFamilyPrefs.cwlInterval) {
        cwlClaim(auth, channelID, clanFamilyPrefs, target, attacker);
        return;
    }

    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: clanFamilyPrefs.warsheet+'!A5:H54',
    }, (err, res) => { 
        if (err) {
            logger.warn('The Google API returned an error: ' + err);
            bot.sendMessage({
                to: channelID,
                message: 'Unable to fetch information. Try again later!'
            });
            return;
        }
        const rows = res.data.values;
        let idx = search2D(rows, 0, attacker);
        if (idx == -1) {
            bot.sendMessage({
                to: channelID,
                message: 'Yo couldn\'t locate player - \'' + attacker + '\'. Please try again!'
            });
            return;
        }
        var playerDiscordId = rows[idx][3];
        if (rows[idx][6] == '-' || rows[idx][7] == '-') {
            bot.sendMessage({
                to: channelID,
                message: 'Smh... \'' + rows[idx][0] + '\' is not in this war bud!'
            });
            return;            
        }
        if (rows[idx][6] != 'XXX' && rows[idx][7] != 'XXX') {
            bot.sendMessage({
                to: channelID,
                message: 'Yo! \'' + rows[idx][0] + '\' doesnt have any attacks left!'
            });
            return;            
        }
        var claimIdx = search2D(rows, 4, target);
        if (claimIdx != -1) {
            bot.sendMessage({
                to: channelID,
                message: '\'' + target + '\' is already claimed! Pick something else.'
            });
            return;            
        }

        idx += 5;
        var now = new Date();
        var date_str = now.toLocaleDateString('en-US', {timeZone: 'America/New_York'});
        date_str += ' ' + now.toLocaleTimeString('en-US', {timeZone: 'America/New_York'});

        
        sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            resource: {
                data: [{
                    range: clanFamilyPrefs.warsheet+'!E'+idx,
                    values: [[target]]
                }, {
                    range: CLAIMS + '!'+clanFamilyPrefs.claimTimeColumn+idx,
                    values: [[moment(new Date()).tz('America/New_York').format('YYYY/M/D HH:mm:s')]]
                    // values: [[new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '')]]
                }],
                valueInputOption: 'USER_ENTERED'
            }
            // range: WAR_LOG+'!E'+idx,
            // valueInputOption: 'RAW',
            // resource: {
            //     values: [[target]]
            // }
        }, (err, result) => {
            if (err) {
                logger.error('Error while updating claim! ' + err);
                bot.sendMessage({
                    to: channelID,
                    message: 'Ugh... Something weird happened. Couldnt plant your stake!'
                });
                return;
            } else {
                if (playerDiscordId == undefined) playerDiscordId = '-';
                bot.sendMessage({
                    to: channelID,
                    message: '<@' + playerDiscordId + '> Goodluck on ' + target + '! Lets gooo! ' + THUMBSUP
                });
            }
        });
    });
}

function cwlClaim(auth, channelID, clanFamilyPrefs, target, attacker) {

}

function claims(auth) {
    const channelID = this.channelID;
    const clanFamilyPrefs = getPreferencesFromChannel(channelID);
    if (clanFamilyPrefs == null) {
        unknownChannelMessage(channelID);
        return ;
    }

    if (clanFamilyPrefs.cwlInterval) {
        cwlClaims(auth, channelID, clanFamilyPrefs);
        return;
    }

    const sheets = google.sheets({version: 'v4', auth});
    const warsheet = clanFamilyPrefs.warsheet;
    const claimAgeColumn = clanFamilyPrefs.claimAgeColumn;

    sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: CLAIMS+'!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [['=NOW()']]
        }
    }, (err, result) => {
        //Do nothing.
        sheets.spreadsheets.values.batchGet({
            spreadsheetId: SPREADSHEET_ID,
            ranges: [warsheet+'!A5:A'+MAX_ROWS, 
                     warsheet+'!B5:B'+MAX_ROWS, 
                     warsheet+'!E5:E'+MAX_ROWS, 
                     'CLAIMS!'+claimAgeColumn+'5:'+claimAgeColumn+MAX_ROWS]
        }, (err, res) => { 
            if (err) {
                logger.warn('The Google API returned an error: ' + err);
                bot.sendMessage({
                    to: channelID,
                    message: 'Unable to fetch information. Try again later!'
                });
                return;
            }
            const playerNames = res.data.valueRanges[0].values;
            const playerDiscordIds = res.data.valueRanges[1].values;
            const playerClaims = res.data.valueRanges[2].values;
            const claimTimes = res.data.valueRanges[3].values;
            var attacksRemaining = 0;
            var message = '';
            if (playerNames.length) {
                let now = new Date();
                for(let i=0; i<playerNames.length; i++) {
                    if (playerClaims!= undefined && playerClaims[i] != undefined 
                        && playerClaims[i][0] != undefined && playerClaims[i][0] != '') {
                        
                        let claimTime = parseInt(claimTimes[i][0])+2;
                        var claimTimeStr = getClaimString(claimTime);
                        message += playerNames[i][0] + ' claimed #' + playerClaims[i][0] + '  ' + claimTimeStr + '\n';
                    }
                }
            } 
            if (message == '') message = 'No claims yet!';
            bot.sendMessage({
                to: channelID,
                message: message
            });
        });
    });
}

function cwlClaims(auth, channelID, clanFamilyPrefs) {

}


function getClaimString(claimTime) {
    var claimTimeStr = '';
    if (claimTime < 0) claimTime = 0;
    if (claimTime >= 60) {
        claimTime = claimTime/60;
        claimTime = Math.round(claimTime*10)/10;
        if (claimTime > 1) claimTimeStr = '' + claimTime + ' hrs ago';
        else claimTimeStr = '' + claimTime + ' hr ago';
    } else if (claimTime == 0) {
        claimTimeStr = ' just now';
    } else {
        if (claimTime > 1) claimTimeStr = '' + claimTime + ' mins ago';
        else claimTimeStr = '' + claimTime + ' min ago';
    }
    return claimTimeStr;
}


function checkClaims(auth) {
    var numClans = Object.keys(CLAN_FAMILY).length;
    for(clanTag in CLAN_FAMILY) {
        numClans--;
        checkClaimsForClan(auth, CLAN_FAMILY[clanTag], numClans==0);
    }
}
/**
 *
 *
 */
function checkClaimsForClan(auth, clanFamilyPrefs, reschedule) {
    const channelID = clanFamilyPrefs.discordChannelId;
    const sheets = google.sheets({version: 'v4', auth});

    sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'CLAIMS!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [['=NOW()']]
        }
    }, (err, result) => {
        var warsheet = clanFamilyPrefs.warsheet;
        var claimAgeColumn = clanFamilyPrefs.claimAgeColumn;

        sheets.spreadsheets.values.batchGet({
            spreadsheetId: SPREADSHEET_ID,
            ranges: [warsheet+'!A5:A'+MAX_ROWS, warsheet+'!D5:D'+MAX_ROWS, warsheet+'!E5:E'+MAX_ROWS, 'CLAIMS!'+claimAgeColumn+'5:'+claimAgeColumn+MAX_ROWS]
        }, (err, res) => { 
            if (err) {
                logger.warn('The Google API returned an error: ' + err);
                bot.sendMessage({
                    to: channelID,
                    message: 'Unable to fetch information. Try again later!'
                });
                return;
            }
            const playerNames = res.data.valueRanges[0].values;
            const playerDiscordIds = res.data.valueRanges[1].values;
            const playerClaims = res.data.valueRanges[2].values;
            const claimTimes = res.data.valueRanges[3].values;
            var attacksRemaining = 0;
            var message = '';
            if (playerNames && playerNames.length>0) {
                let now = new Date();
                for(let i=0; i<playerNames.length; i++) {
                    if (playerClaims!= undefined && playerClaims[i] != undefined 
                        && playerClaims[i][0] != undefined && playerClaims[i][0] != '') {
                        
                        let claimTime = parseInt(claimTimes[i][0])+2;
                        var claimTimeStr = ' ' + getClaimString(claimTime);
                        if (claimTime >= 60) {
                            message = 'Been more than an hour. Gonna unclaim #'+playerClaims[i][0]+' now ' +(playerDiscordIds[i][0]!=undefined ? 'for <@'+playerDiscordIds[i][0]+'>,':', ')  + 'So someone else can take it';
                            bot.sendMessage({
                                to: channelID,
                                message: message
                            });
                            unclaim.bind({'channelID': channelID, 'args': [playerClaims[i][0]]})(auth);
                        } else if (claimTime > 30) {
                            message = (playerDiscordIds[i][0]!=undefined ? '<@'+playerDiscordIds[i][0]+'> ':'')  + playerNames[i][0] + ' claimed #' + playerClaims[i][0] + claimTimeStr + '. Are you still working on it bud?';
                            bot.sendMessage({
                                to: channelID,
                                message: message
                            });
                        }
                    }
                }
            }
            if (reschedule)
                setTimeout(function() {
                    authorize(googleCredentials, checkClaims);
                }, 240000);
        });
    });
}

function isPrivileged(userID, channelID, cmd, parentClan) {
    var clanFamilyPrefs = null;
    if (parentClan) 
        clanFamilyPrefs = getPreferencesOfMainClan();
    else
        clanFamilyPrefs = getPreferencesFromChannel(channelID);

    if (!clanFamilyPrefs) {
        unknownChannelMessage(channelID);
        return false;
    }
    var privilegedMembers = clanFamilyPrefs.privilegedMembers;
    return privilegedMembers.includes(userID);
}

function search2D(someArray, column, searchString) {
    if (!someArray) return -1;
    searchString = searchString.toLowerCase();
    for(var i=0; i<someArray.length; i++) {
        if (someArray[i] == undefined || someArray[i][column] == undefined) continue;
        if (someArray[i][column].toLowerCase() == searchString.toLowerCase()) return i;
    }
    return -1;
}

/**
 * Generate a Google auth token and callsback the given the callback function with 
 * the newly generated OAuth2 token.
 * @param {json} credentials The json representing the OAuth2 credentials.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function authorize(credentials, callback) {
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error while trying to retrieve access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

function getClanTagFromChannel(channelID) {
    for(clanTag in CLAN_FAMILY) {
        var clanFamilyPrefs = CLAN_FAMILY[clanTag];
        if (clanFamilyPrefs.discordChannelId == channelID) {
            return clanTag;
        }
    }
    return null;
}

function getKnownChannelsMsg() {
    var message = "";
    for(clanTag in CLAN_FAMILY) {
        var clanFamilyPrefs = CLAN_FAMILY[clanTag];
        if (message.length > 0)
            message += " or ";
        message += "<#" + clanFamilyPrefs.discordChannelId + ">"
    }
    return message;
}

function getPreferencesOfMainClan() {
    for(clanTag in CLAN_FAMILY) {
        var clanFamilyPrefs = CLAN_FAMILY[clanTag];
        if (clanFamilyPrefs.parentClan) 
            return clanFamilyPrefs;
    }
    return null;
}

function getPreferencesFromChannel(channelID) {
    for(clanTag in CLAN_FAMILY) {
        var clanFamilyPrefs = CLAN_FAMILY[clanTag];
        if (clanFamilyPrefs.discordChannelId == channelID) {
            return clanFamilyPrefs;
        }
    }
    return null;
}

function unknownChannelMessage(channelID) {
    bot.sendMessage({
        to: channelID,
        message: "Please run this command from appropriate channel - " + getKnownChannelsMsg()
    });
}

function compareMaps(map1, map2) {
    var testVal;
    if (map1.size !== map2.size) {
        return false;
    }
    for (var [key, val] of map1) {
        testVal = map2.get(key);
        // in cases of an undefined value, make sure the key
        // actually exists on the object so there are no false positives
        if (testVal !== val || (testVal === undefined && !map2.has(key))) {
            return false;
        }
    }
    return true;
}


const sleep = (milliseconds) => {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}


function Queue() {

    // initialise the queue and offset
    var queue  = [];
    var offset = 0;

    // Returns the length of the queue.
    this.getLength = function(){
        return (queue.length - offset);
    }

    // Returns true if the queue is empty, and false otherwise.
    this.isEmpty = function(){
        return (queue.length == 0);
    }

    /* Enqueues the specified item. The parameter is:
     *
     * item - the item to enqueue
     */
    this.enqueue = function(item){
        queue.push(item);
    }

    /* Dequeues an item and returns it. If the queue is empty, the value
     * 'undefined' is returned.
     */
    this.dequeue = function() {

        // if the queue is empty, return immediately
        if (queue.length == 0) return undefined;

        // store the item at the front of the queue
        var item = queue[offset];

        // increment the offset and remove the free space if necessary
        if (++ offset * 2 >= queue.length){
            queue  = queue.slice(offset);
            offset = 0;
        }

        // return the dequeued item
        return item;

    }

    /* Returns the item at the front of the queue (without dequeuing it). If the
     * queue is empty then undefined is returned.
     */
    this.peek = function(){
        return (queue.length > 0 ? queue[offset] : undefined);
    }

}

