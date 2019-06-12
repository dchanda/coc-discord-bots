const fs = require('fs');
const logger = require('./utils/logger.js');
const readline = require('readline');
const {google} = require('googleapis');
var Discord = require('discord.io');
var moment = require('moment-timezone');
var clashapi = require('./utils/clashapi.js');
var stringify = require('json-stable-stringify');

//var dateMath = require('date-arithmetic')

var discordAuth = require(process.env.CONFIGS_DIR + '/discord-auth.json');
var googleCredentials = require(process.env.CONFIGS_DIR + '/googleapi-credentials.json');
const BOT_CONFIGS = require(process.env.CONFIGS_DIR + '/warlog-bot-configs.json');

//Initialize Google Auth and get/refresh Token
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', ];
const TOKEN_PATH = process.env.CONFIGS_DIR + '/warlogbot-googletoken.json';
const SPREADSHEET_ID = BOT_CONFIGS.spreadsheetId;
const ALMOST_DIVORCED_SERVER_ID = BOT_CONFIGS.discordServerId;
const BOT_DEFAULT_CHANNELID = BOT_CONFIGS.defaultChannelId;
const STAR_EMPTY = '☆'; 
const STAR_FULL = '⭐'; 
const THUMBSUP = '👍';
const WAR_LOG = BOT_CONFIGS.warlogTabName;
const CLAIMS = BOT_CONFIGS.claimsTabName;

const LEADERS = [];
const OFFICERS = [];

const MAINTENANCE = false;

// ------------ GLOBAL RESUABLES  ---------------
var warLogUpdater;
var warLogUpdateInterval;
var opponentClanTagUpdater;
var opponentClanTag = null;
var previousAttackSummary = null;
var warLogLastUpdateTime = new Date().getTime();


// ------------ TIMERS FOR THE BOT! -------------
//Check for claims and remind players every 4mins.
setTimeout(function() {
    authorize(googleCredentials, checkClaims);
}, 240000);

scheduleWarLogUpdater(30000);

//Refersh Clan Tag every 1 hr.
opponentClanTagUpdater = setInterval( function() {
    opponentClanTag = null;
}, 3600000);

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
        switch(cmd) {
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
            case 'summary':
                authorize(googleCredentials, summary.bind({'channelID': channelID, 'detail': false}));
                break;
            case 'psummary':
                authorize(googleCredentials, summary.bind({'channelID': channelID, 'detail': true}));
                break;
            case 'link':
                authorize(googleCredentials, link.bind({'channelID': channelID, 'args': args}));
                break;
            case 'pnotify':
                if (LEADERS.includes(userID) || OFFICERS.includes(userID))
                    authorize(googleCredentials, notify.bind({'channelID': channelID}));
                break;
            case 'claims':
                authorize(googleCredentials, claims.bind({'channelID': channelID}));
                break;
            case 'claim':
                if (LEADERS.includes(userID) || OFFICERS.includes(userID))
                    authorize(googleCredentials, claim.bind({'channelID': channelID, 'args': args}))
                break;
            case 'unclaim':
                if (LEADERS.includes(userID) || OFFICERS.includes(userID))
                    authorize(googleCredentials, unclaim.bind({'channelID': channelID, 'args': args}))
                break;
            case 'attack':
                if (LEADERS.includes(userID) || OFFICERS.includes(userID))
                    authorize(googleCredentials, attack.bind({'channelID': channelID, 'args': args}))
                break;
         }
     }
});

function getServer() {
    return bot.servers[ALMOST_DIVORCED_SERVER_ID];
}

function cacheUserRoles(server) {
    var channels = server.channels;
    for(var id in channels) {
        console.log(id + " - " + channels[id].name);
    }
    var roles = server.roles;
    var officer_role_id = '';
    var leader_role_id = '';
    for(var roleid in roles) {
        var role = roles[roleid];
        if (role.name == 'Officer') {
            officer_role_id = role.id;
            continue;
        } else if (role.name == 'Leader') {
            leader_role_id = role.id;
            continue;
        }
    }

    var members = server.members;
    for(var memberid in members) {
        var member = members[memberid];
        // if (!member.bot) {
        //     console.log(member.username + "  -  " + member.id);
        // }
        if (member.roles.includes(officer_role_id))
            OFFICERS.push(member.id);
        if (member.roles.includes(leader_role_id))
            LEADERS.push(member.id);
    }

}

function scheduleWarLogUpdater(timeInMilliSeconds) {
    if (timeInMilliSeconds == warLogUpdateInterval) return;
    if (warLogUpdater) {
        clearInterval(warLogUpdater);
    }
    // Update war log every 30secs.
    warLogUpdater = setInterval( function() {
        authorize(googleCredentials, fetchAndUpdateWarLog);
    }, timeInMilliSeconds);
    warLogUpdateInterval = timeInMilliSeconds;
}

function fetchAndUpdateWarLog(auth) {
    const sheets = google.sheets({version: 'v4', auth});
    if (opponentClanTag) {
        if (opponentClanTag == 'X') {
            return;
        } else {
            clashapi.getAttackSummary('', opponentClanTag, _updateWarLog.bind({auth: auth}));
            return;
        }
    }
    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: WAR_LOG+'!G2',
    }, (err, res) => { 
        if(err) {
            logger.warn('Unable to fetch opponent clan Tag.');
            return;
        }
        opponentClanTag = res.data.values[0][0];
        clashapi.getAttackSummary('', opponentClanTag, _updateWarLog.bind({auth: auth}));
    });
}

function _updateWarLog(err, attackSummary) {
    var auth = this.auth;
    if (err) {
        if (err.code == 100) {
            var duration = err.startTime.diff(moment(), 'milliseconds');
            logger.info('War starts in - ' + duration + 'ms. Rescheduling the update interval.');
            scheduleWarLogUpdater(duration);
            return;
        } else if (err.code == 403) {
            logger.info('War log is not public. Changing the update interval to 1hr.');
            scheduleWarLogUpdater(3600000);
            return;
        } else {
            logger.info('Error while fetching war log: ' + err);
            return;
        }
    }
    scheduleWarLogUpdater(30000);
    const sheets = google.sheets({version: 'v4', auth});
    sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [WAR_LOG+'!A5:B54', WAR_LOG+'!E5:E54']
    }, (err, res) => { 
        if(err) {
            logger.warn('Unable to fetch Clan Members data from Sheets.');
            return;
        }
        //If last update was more than 5 mins ago, we force an update.
        if ((new Date().getTime() - warLogLastUpdateTime) > 300000) previousAttackSummary = null;
        if (previousAttackSummary) {
            if (stringify(previousAttackSummary) === stringify(attackSummary)) {
                logger.info('No change in war log. Skipping updates.');
                previousAttackSummary = attackSummary;
                return;
            }
        }
        previousAttackSummary = attackSummary;
        var playersData = res.data.valueRanges[0].values;
        var claims = res.data.valueRanges[1].values;
        var idx = 0;
        var warLogUpdate = [];
        var messages = [];
        var updateData = [];
        for(var i=0; i<playersData.length; i++) {
            var playerTag = playersData[i][1];
            if (claims && claims[i] && claims[i][0] != '') {
                updateData.push({range: WAR_LOG+'E'+(i+5), values: [['']]});
            }
            if (playerTag in attackSummary) {
                var playerAttacks = attackSummary[playerTag];
                if ('attack1' in playerAttacks) {
                    if ('attack2' in playerAttacks) {
                        warLogUpdate.push([ playerAttacks.attack1,playerAttacks.attack2 ]);
                    } else {
                        warLogUpdate.push([ playerAttacks.attack1,'XXX' ]);
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
        updateData.push({range: WAR_LOG+'!G5:H'+ (warLogUpdate.length+4),values: warLogUpdate});
        updateData.push({range: CLAIMS+'!E2:E'+(baseStatus.length+1),values: baseStatus});
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
        logger.info('Updating war log...');
    });
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
            }]
          }
    })
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
        range: WAR_LOG+'!A5:D54',
    }, (err, res) => {
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
            idx = search2D(playersData, 1, playerName);
        } else {
            idx = search2D(playersData, 0, playerName);
        }
        if (idx == -1) {
            //Need to add this player as he is not in the spreadsheet yet.
            var i=0
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
                    range: WAR_LOG+'!E'+idx,
                    values: [['']]
                }, {
                    range: CLAIMS + '!A'+idx,
                    values: [[moment(new Date()).tz('America/New_York').format('YYYY/M/D HH:mm:s')]]
                }]
        data = [];
        if (playerName.startsWith('#'))
            data.push({range: WAR_LOG+'!B'+(idx+5), values: [[playerName]]});
        else 
            data.push({range: WAR_LOG+'!A'+(idx+5), values: [[playerName]]});
        data.push({range: WAR_LOG+'!D'+(idx+5), values: [[playerDiscordId]]});

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
    const channelID = BOT_DEFAULT_CHANNELID;
    const sheets = google.sheets({version: 'v4', auth});
    sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [WAR_LOG+'!A5:A54', WAR_LOG+'!D5:D54', WAR_LOG+'!E5:E54', WAR_LOG+'!G5:H54', CLAIMS+'!C2:C52']
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
        const discordIds = res.data.valueRanges[1].values;
        const claims = res.data.valueRanges[2].values;
        const warlog = res.data.valueRanges[3].values;
        const exclusionList = res.data.valueRanges[4].values;

        var twoAttacksRemainingList = [];
        var oneAttackRemainingList = [];

        for(var i=0; i<warlog.length; i++) {
            if (search2D(exclusionList, 0, playerNames[i][0]) > -1) {
                continue;
            }
            var attacksRemainingForThisPlayer = 0;
            if (warlog[i][0] == 'XXX') attacksRemainingForThisPlayer++;
            if (warlog[i][1] == 'XXX') attacksRemainingForThisPlayer++;

            if (attacksRemainingForThisPlayer > 1)
                twoAttacksRemainingList.push([discordIds[i][0], playerNames[i][0]]);
            else if (attacksRemainingForThisPlayer > 0) 
                oneAttackRemainingList.push([discordIds[i][0], playerNames[i][0]]);
        }

        if (twoAttacksRemainingList.length > 0) {
            var message = '';
            twoAttacksRemainingList.forEach( element => {
                if ( element[0] && element[0] !='' )
                    message += ' <' + '@' + element[0] + '> ' + element[1];
            })
            message += ' have 2 attacks left in war. Always get both your attacks in.';
            bot.sendMessage({
                to: channelID,
                message: message
            });
        }
        if (oneAttackRemainingList.length > 0) {
            var message = '';
            oneAttackRemainingList.forEach( element => {
                if ( element[0] && element[0] !='' )
                    message += ' <' + '@' + element[0] + '> ' + element[1];
            })
            message += ' You have 1 attack left. Don\'t forget to always use both attacks.';
            bot.sendMessage({
                to: channelID,
                message: message
            });
        }
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
    sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [WAR_LOG+'!A5:A54', WAR_LOG+'!G5:H54', CLAIMS+'!E2:E41', CLAIMS+'!H1']
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
        } else {
            basesRemaining = 'All bases are open! Looks like war hasn\'t started yet!'
        }
        if (!detail)
            attacksRemaining = '';

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

function attack(auth) {
    //const channelID = BOT_DEFAULT_CHANNELID;
    const channelID = this.channelID;
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
    sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [WAR_LOG+'!A5:A54', WAR_LOG+'!D5:D54', WAR_LOG+'!E5:E54', WAR_LOG+'!G5:H54', 'CLAIMS!E2:E41']
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
        var firstAttack = true;
        let playerIdx = -1;
        if (attacker == '')
            playerIdx = search2D(playerClaims, 0, ''+attackedBaseNumber);
        else  
            playerIdx = search2D(playerNames, 0, attacker);
        
        var data = [];

        if (baseStatus && baseStatus[attackedBaseNumber-1] && (''+baseStatus[attackedBaseNumber-1][0] != '3')) {
            //This is to record the current number of stars on a base. If already 3 starred, then no need to update.
            data.push([{range: CLAIMS+'!E'+(attackedBaseNumber+1), values: [[stars]]}]); 
        } else if (!baseStatus || !baseStatus[attackedBaseNumber-1]) {
            data.push([{range: CLAIMS+'!E'+(attackedBaseNumber+1), values: [[stars]]}]); 
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
            data.push({range: WAR_LOG+'!E'+(playerIdx+5),values: [['']]});
            //This is the attack record (could be col G or H.)
            data.push({range: WAR_LOG+'!'+(firstAttack?'G':'H')+(playerIdx+5),values: [[stars]]});
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
        range: WAR_LOG+'!A5:H54',
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
                    range: WAR_LOG+'!E'+idx,
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

    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: WAR_LOG+'!A5:H54',
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
                    range: WAR_LOG+'!E'+idx,
                    values: [[target]]
                }, {
                    range: CLAIMS + '!A'+idx,
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

function search2D(someArray, column, searchString) {
    if (!someArray) return -1;
    searchString = searchString.toLowerCase();
    for(var i=0; i<someArray.length; i++) {
        if (someArray[i] == undefined || someArray[i][column] == undefined) continue;
        if (someArray[i][column].toLowerCase() == searchString.toLowerCase()) return i;
    }
    return -1;
}

function claims(auth) {
    const channelID = this.channelID;
    const sheets = google.sheets({version: 'v4', auth});
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
            ranges: [WAR_LOG+'!A5:A54', WAR_LOG+'!B5:B54', WAR_LOG+'!E5:E54', 'CLAIMS!B5:B54']
            // valueRenderOption: 'UNFORMATTED_VALUE',
            // dateTimeRenderOption: 'SERIAL_NUMBER'
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

/**
 *
 *
 */
function checkClaims(auth) {
    const channelID = BOT_DEFAULT_CHANNELID;
    const sheets = google.sheets({version: 'v4', auth});
    sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: 'CLAIMS!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
            values: [['=NOW()']]
        }
    }, (err, result) => {
        //Do nothing.
        sheets.spreadsheets.values.batchGet({
            spreadsheetId: SPREADSHEET_ID,
            ranges: [WAR_LOG+'!A5:A54', WAR_LOG+'!D5:D54', WAR_LOG+'!E5:E54', 'CLAIMS!B5:B54']
            // valueRenderOption: 'UNFORMATTED_VALUE',
            // dateTimeRenderOption: 'SERIAL_NUMBER'
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
            setTimeout(function() {
                authorize(googleCredentials, checkClaims);
            }, 240000);
        });
    });
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
