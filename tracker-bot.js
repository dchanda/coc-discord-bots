const logger = require('./utils/logger.js');
const fs = require('fs');
const models = require('./model/clashmodels.js');
const clashapi = require('./utils/clashapi.js')
const Discord = require('discord.io');
const async = require('async');
const scheduler = require('node-schedule');
const moment = require('moment-timezone');
const axios = require('axios');
const cheerio = require('cheerio');
const {google} = require('googleapis');
const readline = require('readline');

const discordAuth = require(process.env.CONFIGS_DIR + '/discord-auth.json');
const googleCredentials = require(process.env.CONFIGS_DIR + '/googleapi-credentials.json');
const BOT_CONFIGS = require(process.env.CONFIGS_DIR + '/tracker-bot-configs.json');
const RESEARCH_DATA_BASEURL = 'https://clashofclans.fandom.com/wiki/';
const SPREADSHEET_ID = BOT_CONFIGS.spreadsheetId;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', ];

const CLAN_BIRTHDAY = moment('28 Dec 2018','DD MMM YYYY');

const RESEARCH_DATA = {};
const TOKEN_PATH = process.env.CONFIGS_DIR + '/trackerbot-googletoken.json';
const CLAN_TAGS = BOT_CONFIGS.clanFamilyTags;
const ALMOST_DIVORCED_SERVER_ID = BOT_CONFIGS.discordServerId;
const BOT_ANNOUNCE_CHANNELID = BOT_CONFIGS.defaultChannelId;
const BOT_PRIV_ANNOUNCE_CHANNELID = BOT_CONFIGS.defaultPriviledgeChannelId;
const MAX_TROOPS = {};
const MAX_SPELLS = {};
const MAX_AWAY_DAYS = 15;
const MAX_ROWS = 150;
const PRIVILEGED_MEMBERS = new Set();

const MAINTENANCE = BOT_CONFIGS.maintenance;

const TROOP_NAMES = {
    barbarian: 'Barbarian',
    archer: 'Archer',
    giant: 'Giant',
    goblin: 'Goblin',
    wallbreaker: 'Wall Breaker',
    balloon: 'Balloon',
    wizard: 'Wizard',
    healer: 'Healer',
    dragon: 'Dragon',
    pekka: 'P.E.K.K.A',
    babydragon: 'Baby Dragon',
    miner: 'Miner',
    electrodragon: 'Electro Dragon',
    minion: 'Minion',
    hogrider: 'Hog Rider',
    valkyrie: 'Valkyrie',
    golem: 'Golem',
    witch: 'Witch',
    lavahound: 'Lava Hound',
    bowler: 'Bowler',
    icegolem: 'Ice Golem',
    barbarianKing: 'Barbarian King',
    archerQueen: 'Archer Queen',
    grandWarden: 'Grand Warden',
};

const HEROES = {
    barbarianKing: 'Barbarian King',
    archerQueen: 'Archer Queen',
    grandWarden: 'Grand Warden',
}

const SPELL_NAMES = {
    lightning: 'Lightning Spell',
    heal: 'Healing Spell',
    rage: 'Rage Spell',
    jump: 'Jump Spell',
    freeze: 'Freeze Spell',
    clone: 'Clone Spell',
    poison: 'Poison Spell',
    earthquake: 'Earthquake Spell',
    haste: 'Haste Spell',
    skeleton: 'Skeleton Spell',
    bat: 'Bat Spell',
};

const CLAN_NAMES = {
    "#22V9VC28V": "Almost Divorced",
    "#29829QQCY": "Mostly Divorced",
    "#2PYQLRJY8": "Nearly  Divorced"
}

const traderEmojiMap = {
    'Wall Rings x5': '<:wallringsx5:631977396777648175>',
    'Wall Rings x10': '<:wallringsx10:631977396769128488>',
    'BoH': '<:boh:631972385314045972>',
    'Hero Potion': '<:heropotion:631972385171439616>',
    '[FREE] Training Potion': '<:freetrainingpotion:631991959485022257>',
    'Training Potion': '<:trainingpotion:631972385163313162>',
    'Rune of Gold': '<:runeofgold:631972385133690890>',
    'Resource Potion': '<:resourcepotion:631972385104330752>',
    'Power Potion': '<:powerpotion:631972385041547314>',
    'Shovel': '<:shovel:631972385033289729>',
    'Builder Potion': '<:builderpotion:631972385024638976>',
    'ClockTower Potion': '<:clocktowerpotion:631972384932626468>',
    '[FREE] ClockTower Potion': '<:freeclocktowerpotion:631991958927048735>',
    'Rune of Dark Elixir': '<:runeofdarkelixir:631972384840351744>',
    'BoS': '<:bos:631972384743751682>',
    'BoB': '<:bob:631972384735232051>',
    'BoF': '<:bof:631972384790020099>',
    'Research Potion': '<:researchpotion:631972384618053642>',
    'Rune of Elixir': '<:runeofelixir:631972384605208577>',
    'Rune of Builder Gold': '<:runeofbuildergold:631972384588562433>',
    'Rune of Builder Elixir': '<:runeofbuilderelixir:631972384785694721>'
}

// ---- GLOBAL VARIABLES -----
var playersMap = {};
var responseChannelId = null;

const saveMemberQueue = async.queue(function(memberTag, callback) {
    _fetchAndSaveMember(memberTag, null, callback);
}, 5);

const loadMemberQueue = async.queue(function(memberTag, callback) {
    _fetchAndSaveMember(memberTag, playersMap, callback);
}, 5);

const fetchResearchInfoQueue = async.queue(_fetchResearchData, 5);

const masterRosterQueue = async.queue(addMemberToMasterRoster, 1);

loadMemberQueue.drain = _announceUpgrades;

fetchResearchInfoQueue.drain = function() {
    console.log('Caching Research Data Complete');
};

// Initialize Discord Bot
var bot = new Discord.Client({
   token: discordAuth.tracker.token,
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

    cacheUserRoles(server);
    cacheMaxLevels();
    cacheResearchData();
    loadWatchedMessageIds();
    setInterval(function() {
        checkNewMembers();
    }, 60000);
    setInterval(function() {
        uploadcwldata();
    }, 300000);
    setTimeout(announceUpgrades, 2000);
    scheduler.scheduleJob('0 0,8,12,16,20 * * *', announceUpgrades);
    scheduler.scheduleJob('0 8 * * *', checkClanJoinDates);
    scheduler.scheduleJob('0 17 * * *', announceTraderCycle);
});

bot.on('any', function(event) {
    if ("t" in event && (event.t == "MESSAGE_REACTION_ADD" || event.t=="MESSAGE_REACTION_REMOVE")) {
        var messageID = event.d.message_id;
        var channelID = event.d.channel_id;
        var userID = event.d.user_id;
        var emoji = event.d.emoji.name;
        if (userID == BOT_CONFIGS.botUserId) return;
        if (watchedMessageIds.has(messageID)) {
            if (ALL_VALID_REACTIONS.has(emoji)) {
                if (event.t == "MESSAGE_REACTION_ADD") {
                    handleReaction(channelID, messageID, emoji, true);
                } else if (event.t == "MESSAGE_REACTION_REMOVE") {
                    handleReaction(channelID, messageID, emoji, false);
                }
            }
        }
    }
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
            case 'help':
                help(channelID);
                break;
            case 'adhelp':
                help(channelID);
                break;
            case 'rushed':
                //if (LEADERS.includes(userID) || OFFICERS.includes(userID))
                    rushed(channelID, args, false);
                break;
            case 'lab':
                researchInfo(channelID, args, false);
                break;
            case 'hero':
                researchInfo(channelID, args, true);
                break;
            case 'trader':
                announceTraderCycle(channelID);
                break;
            case 'dates':
                //if (LEADERS.includes(userID) || OFFICERS.includes(userID))
                    memberDate(channelID, args);
                break;
            case 'cwlpoll':
                if (PRIVILEGED_MEMBERS.has(userID))
                    authorize(googleCredentials, cwlpoll);
                break;
            case 'uploadcwldata':
                if (PRIVILEGED_MEMBERS.has(userID))
                    uploadcwldata();
                break;
            case 'purgecwlpoll':
                if (PRIVILEGED_MEMBERS.has(userID))
                    if (args.length > 0)
                        purgeCwlPoll(args[0]);
                    else
                        purgeCwlPoll();
                break;
            case 'date':
                //if (LEADERS.includes(userID) || OFFICERS.includes(userID))
                    memberDate(channelID, args);
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
    var roles = server.roles;

    console.log("Roles->");
    for(var roleid in roles) {
        var role = roles[roleid];
        console.log(role.id + " - " + role.name);
    }

    var members = server.members;
    for(var memberid in members) {
        var member = members[memberid];
        BOT_CONFIGS.privilegedRoleIds.forEach(roleId => {
            if (roleId && member.roles.includes(roleId))
                PRIVILEGED_MEMBERS.add(member.id);
        });
    }
}

function announceTraderCycle(channelID) {
    if (arguments.length == 0) {
        channelID = BOT_PRIV_ANNOUNCE_CHANNELID;
    }
    authorize(googleCredentials, (auth) => {
        const sheets = google.sheets({version: 'v4', auth});

        sheets.spreadsheets.values.batchGet({
            spreadsheetId: SPREADSHEET_ID,
            ranges: [
                'TRADER!A1:E40',
                'ROSTER!A1:B'+MAX_ROWS,
                'ROSTER!K1:K'+MAX_ROWS,
            ]
        }, (err, res) => {
            if (err) {
                console.log(err);
                return;
            }
            const traderData = res.data.valueRanges[0].values;
            const playerData = res.data.valueRanges[1].values;
            const playerTraderPositions = res.data.valueRanges[2].values;

            var cycleStartDate = moment(traderData[0][4], 'YYYYMMDDTHHmmss.SSSZ');
            var duration = moment.duration(moment().diff(cycleStartDate));
            var step = duration.days();
            if (duration.hours() > 0 || duration.minutes() > 0 || duration.seconds() > 0) {
                step += 1;
            }
            var message = '\n';
            var embed = {
                color: 13683174,
                description: '',
                footer: { 
                    text: '© Almost Divorced Clan'
                },
                thumbnail: {
                    url: ''
                },
                title: 'Trader Offers',
                fields: []
            }
            for(var i=1; i<playerData.length; i++) {
                if (playerData[i].length == 0) break;
                if (playerTraderPositions.length > i && playerTraderPositions[i] && playerTraderPositions[i].length>0) {
                    var playerPosition = parseInt(playerTraderPositions[i][0]);
                    playerPosition += step;
                    while (playerPosition > 39) playerPosition = playerPosition - 39;
                    console.log(playerData[i][1] + " : " + playerPosition);
                    var name = playerData[i][1];
                    while (name.length < 14) name += ' ';
                    traderEmojiMap[traderData[playerPosition][1]]

                    message += '`' + name + '` ' + traderEmojiMap[traderData[playerPosition][1]] + '  ' + traderEmojiMap[traderData[playerPosition][2]] + '  ' + traderEmojiMap[traderData[playerPosition][3]] + '\n';
                }
            }
            message += '\n';
            bot.sendMessage({
                to: channelID,
                //to: '631971808639451174',
                message: message
            });
        });
    });
}

function cacheMaxLevels() {
    models.TroopMaximums.findAll().then( maxTroops => {
        maxTroops.forEach( maxTroop => {
            MAX_TROOPS[maxTroop.townhallLevel] = maxTroop;
        });
    });
    models.SpellMaximums.findAll().then( maxSpells => {
        maxSpells.forEach( maxSpell => {
            MAX_SPELLS[maxSpell.townhallLevel] = maxSpell;
        });
    });
}

function cacheResearchData() {
    for(var troopName in TROOP_NAMES) {
        fetchResearchInfoQueue.push(TROOP_NAMES[troopName]);
    }

    for(var spellName in SPELL_NAMES) {
        fetchResearchInfoQueue.push(SPELL_NAMES[spellName]);
    }    
}

function checkClanJoinDates() {
    var today = moment(new Date());
    //Check 6 month anniversary
    if (today.date() == CLAN_BIRTHDAY.date()) {
        var anniversaryMonths = today.diff(CLAN_BIRTHDAY, "months");
        var msg = ':tada: @everyone, Congratulations on ' + anniversaryMonths + ' Month Anniversary! Good going! :tada:';
        bot.sendMessage({
            to: BOT_ANNOUNCE_CHANNELID,
            message: msg
        });
    }

    var message_parts = [];
    models.PlayerData.findAll().then(currentMembers => {
        var message = '';
        var now = moment(new Date());
        curentMembers = currentMembers.sort(dateComparator);
        currentMembers.forEach(member => {
            if (!member.inClan) return;
            var joinDate = moment(member.joinDate);
            var duration = moment.duration(now.diff(joinDate));
            if (duration.days() == 0) {
                if (duration.years() > 0) {
                    if (duration.years() > 1)
                        message += `:tada: ** ${member.name} ** \`completed ${duration.years()}years`;
                    else 
                        message += `:tada: ** ${member.name} ** \`completed ${duration.years()}year`;
                    if (duration.months() > 1) {
                        message += ` ${duration.months()}months`;
                    } else if (duration.months() > 0)
                        message += ` ${duration.months()}month`;
                    message += " with us today! `\n";
                } else if (duration.months() > 0) {
                    message += `:tada: ** ${member.name} ** \`completed`;
                    if (duration.months() > 1) {
                        message += ` ${duration.months()}months`;
                    } else 
                        message += ` ${duration.months()}month`;
                    message += " with us today! `\n";
                }                
            }
            if ( (message.match(/\n/g) || []).length > 30 ) {
                message_parts.push(message);
                message = '';
            }
        });
        message_parts.push(message);

        var sleepDuration = 5;
        message_parts.forEach(message_part => {
            logger.debug("Message Part: " + message_part);
            sleep(sleepDuration).then(() => {
                bot.sendMessage({
                    to: BOT_ANNOUNCE_CHANNELID,
                    message: message_part
                });
            });
            sleepDuration += 100;
        });
    });
}

function loadWatchedMessageIds() {
    models.CwlRsvp.findAll().then(cwlRsvps => {
        cwlRsvps.forEach(cwlRsvp => {
            if (cwlRsvp.firstquestion)
                watchedMessageIds.add(cwlRsvp.firstquestion);
            if (cwlRsvp.secondquestion)
                watchedMessageIds.add(cwlRsvp.secondquestion);
        });
    });
}


function researchInfo(channelID, args, heroes) {
    var memberName = null;
    var discount = 1;
    if (args.length > 0) {
        if ( args[args.length-1].endsWith('%') ) {
            discount = 1 - (parseInt(args.pop()) *  0.01);
            if (discount < 0.7) {
                bot.sendMessage({
                    to: channelID,
                    message: 'That discount is absurd! Are you even playing Clash of Clans??'
                });
                return;
            }
        }
        memberName = args.join(' ');
    } else {
        bot.sendMessage({
            to: channelID,
            message: 'Need a player name of playerTag bud!'
        });
        return;
    }
    
    if ( memberName.startsWith('#') ) {
        var playerHolder = {};
        _fetchAndSaveMember(memberName, playerHolder, function() {
            var playerObject = playerHolder[Object.keys(playerHolder)[0]];
            _parseAndAnnounceResearchInfo(playerObject, channelID, discount, heroes);
        });        
    } else {
        //where = {lower(name): memberName};
        where = models.sequelize.where(
            models.sequelize.fn('lower', models.sequelize.col('name')),
            memberName.toLowerCase()
        );
        models.PlayerData.findAll({ 
            where: where,
            include: [{ all: true }]
        }).then(currentMembers => {
            if (currentMembers.length == 0) {
                bot.sendMessage({
                    to: channelID,
                    message: 'Cannot find player with name: "' + memberName + '"'
                });
                return;
            }
            var member = currentMembers[0];
            _parseAndAnnounceResearchInfo(member, channelID, discount, heroes);
        });
    }
}

function _parseAndAnnounceResearchInfo(member, channelID, discount, heroes) {
    var maxTroops = MAX_TROOPS[member.townhallLevel];
    var maxSpells = MAX_SPELLS[member.townhallLevel];

    var playerTroops = member.Troops;
    var playerSpells = member.Spells;
    var message = '';
    var message_parts = [];
    var lineLimit = 20;
    var totalElixir = 0;
    var totalDE = 0;
    var totalTime = 0;
    for(var troopName in TROOP_NAMES) {
        var troopLevel = playerTroops[troopName];
        var troopDispName = TROOP_NAMES[troopName];
        if (heroes) {
            if (!(troopName in HEROES)) continue;
        } else {
            if (troopName in HEROES) continue;
        }

        if ( troopLevel < maxTroops[troopName]) {
            for(var i=troopLevel; i<maxTroops[troopName]; i++) {
                if (i == 0) continue;
                var cost = RESEARCH_DATA[troopDispName+'-'+(i+1)].cost;
                cost = parseFloat(cost) * discount;
                var rsrcImage = '<:elixir:592937576642641930>';
                if (RESEARCH_DATA[troopDispName+'-'+(i+1)].resource == 'DE') {
                    rsrcImage = '<:darkelixir:592937634028847135>';
                    totalDE += cost;
                    cost = cost.toPrecision(3) + 'k';
                } else {
                    totalElixir += cost;
                    cost = cost.toPrecision(3) + 'm';
                }
                
                var time = RESEARCH_DATA[troopDispName+'-'+(i+1)].time;
                totalTime += (getTime(time) * discount);
                time = formatTime( getTime(time) * discount );
                var name = TROOP_NAMES[troopName].padEnd(16);
                message += `\`${name} lvl-${i}  to lvl-${i+1}: ${cost}\` ${rsrcImage} \`${time}\`\n`;
                if ( (message.match(/\n/g) || []).length > lineLimit ) {
                    message_parts.push(message);
                    message = '';
                }
            }
        }
    }
    if (!heroes) {
        for(var spellName in SPELL_NAMES) {
            var spellLevel = playerSpells[spellName];
            var spellDispName = SPELL_NAMES[spellName];
            if ( spellLevel < maxSpells[spellName]) {
                for(var i=spellLevel; i<maxSpells[spellName]; i++) {
                    if (i == 0) continue;
                    var cost = RESEARCH_DATA[spellDispName+'-'+(i+1)].cost;
                    cost = parseFloat(cost) * discount;
                    var rsrcImage = '<:elixir:592937576642641930>';
                    if (RESEARCH_DATA[spellDispName+'-'+(i+1)].resource == 'DE') {
                        rsrcImage = '<:darkelixir:592937634028847135>';
                        totalDE += cost;
                        cost = cost.toPrecision(3) + 'k';
                    } else {
                        totalElixir += cost;
                        cost = cost.toPrecision(3) + 'm';
                    }
                    var time = RESEARCH_DATA[spellDispName+'-'+(i+1)].time;
                    totalTime += (getTime(time) * discount);
                    time = formatTime( getTime(time) * discount );
                    var name = SPELL_NAMES[spellName].padEnd(16);
                    message += `\`${name} lvl-${i}  to lvl-${i+1}: ${cost}\` ${rsrcImage} \`${time}\`\n`;
                    if ( (message.match(/\n/g) || []).length > lineLimit ) {
                        message_parts.push(message);
                        message = '';
                    }
                }
            }
        }
    }
    if (totalElixir == 0 && totalDE == 0) {
        message = '`All research completed!`';
        if (heroes) message = '`Heroes maxed!`';
    }
    message += "\n";
    if (totalElixir > 0) { 
        message += `\`Total \`<:elixir:592937576642641930>\` : ${totalElixir.toPrecision(5)}m \`\n`;
    }
    if (totalDE > 0) {
        message += `\`Total \`<:darkelixir:592937634028847135>\` : ${totalDE.toPrecision(5)}k \`\n`;
    }
    if (totalTime > 0) {
        message += `\`Total time: ${formatTime(totalTime)}\`\n`;
    }
    message_parts.push(message);
    var sleepDuration = 5;
    message_parts.forEach(message_part => {
        var tmpMessage = message_part;
        logger.debug("Message Part: " + tmpMessage);
        sleep(sleepDuration).then(() => {
            bot.sendMessage({
                to: channelID,
                message: tmpMessage
            });
        });
        sleepDuration += 200;
    });
}

function getTime(timeStr) {
    var total = 0;
    var parts = timeStr.trim().split(' ');
    while (parts.length > 0) {
        var part = parts.shift();
        if (part.endsWith('d') || part.endsWith('days'))
            total += (parseInt(part) * 24);
        else if (part.endsWith('h'))    
            total += parseInt(part)
        else if (parts.length > 0 && (parts[0] == 'days' || parts[0] == 'd')) {
            parts.shift();
            total += parseInt(part) * 24;
        } else if (parts.length > 0 && parts[0] == 'h') {
            parts.shift();
            total += parseInt(part);
        }
    }

    return total;    
}


function formatTime(time) {
    if ( time%24 > 0 )
        return `${Math.floor(time/24)}d ${Math.round(time%24)}h`;
    else 
        return `${time/24}d`;
}

function memberDate(channelID, args) {
    var memberName = null;
    if (args.length > 0) {memberName = args.join(' '); memberName = memberName.toLowerCase();}
    var message_parts = [];
    models.PlayerData.findAll().then(currentMembers => {
        var message = '';
        var now = moment(new Date());
        curentMembers = currentMembers.sort(dateComparator);
        currentMembers.forEach(member => {
            if (!member.inClan) return;
            if (memberName != null) {
                if (memberName.toLowerCase() != member.name.toLowerCase())
                    return;
            }
            var joinDate = moment(member.joinDate);
            var duration = moment.duration(now.diff(joinDate));
            message += '**' + member.name + '** joined us on **';
            message += joinDate.format('MMM Do YYYY') + '** (';
            if (duration.years() > 0)
                message += duration.years() + 'yrs ';
            if (duration.months() > 0)
                message += duration.months() + 'm ';
            if (duration.days() > 0)
                message += duration.days() + 'd ';
            if (duration.days()==0 && duration.months()==0)
                message += duration.hours() + 'hrs ';
            message += 'ago)\n';
            if ( (message.match(/\n/g) || []).length > 30 ) {
                message_parts.push(message);
                message = '';
            }
        });
        message_parts.push(message);

        var sleepDuration = 5;
        message_parts.forEach(message_part => {
            logger.debug("Message Part: " + message_part);
            sleep(sleepDuration).then(() => {
                bot.sendMessage({
                    to: channelID,
                    message: message_part
                });
            });
            sleepDuration += 100;
        });
    });
}

function rushed(channelID, args, thUpgraded) {
    var memberName = null;
    if (args.length > 0) {memberName = args.join(' '); memberName = memberName.toLowerCase();}
    var message = '';
    var message_parts = [];
    if ( memberName == null || !memberName.startsWith('#') ) {
        models.PlayerData.findAll({ include: [{ all: true }]}).then(currentMembers => {
            currentMembers.forEach( member => {
                if (!member.inClan) return;
                if ( memberName != null) {
                    if (! member.name.toLowerCase().includes(memberName)) {
                        return;
                    }
                }
                message += _calculateRushed(member, thUpgraded);
                if ( (message.match(/\n/g) || []).length > 40 ) {
                    logger.debug('Rushed message part: ' + message);
                    message_parts.push(message);
                    message = '';
                }
            });
            logger.debug('Rushed message final: ' + message);
            message_parts.push(message);
            if (!MAINTENANCE) {
                logger.info('Found '+message_parts.length + ' pages of message');
                message_parts.forEach(message_part => {
                    var title = (thUpgraded) ? 'TH Upgraded': 'Rushed';
                    bot.sendMessage({
                        to: channelID,
                        embed: {
                            color: 13683174,
                            description: '' + message_part + '',
                            footer: {
                                text: ''
                            },
                            thumbnail: {
                                url: ''
                            },
                            title: title,
                            url: ''
                        }
                    });
                });
            }
        });
    } else {
        var playerHolder = {};
        _fetchAndSaveMember(memberName, playerHolder, function() {
            var playerObject = playerHolder[Object.keys(playerHolder)[0]];
            playerObject['inClan'] = false;
            message = _calculateRushed(playerObject, false);
            bot.sendMessage({
                to: channelID,
                embed: {
                    color: 13683174,
                    description: message,
                    footer: {
                        text: ''
                    },
                    thumbnail: {
                        url: ''
                    },
                    title: 'Offense info',
                    url: ''
                }
            });
        });
    }
}

function _calculateRushed(member, thUpgraded) {
    var message = '';
    if (thUpgraded) {
        message += member.name + ' upgraded Town Hall to level ' + member.townhallLevel + '\n';
    }
    if (member.townhallLevel > 1) {
        var maxTroops = MAX_TROOPS[member.townhallLevel-1];
        var maxSpells = MAX_SPELLS[member.townhallLevel-1];

        var playerTroops = member.Troops;
        var playerSpells = member.Spells;

        for(var troopName in TROOP_NAMES) {
            if (playerTroops[troopName]  < maxTroops[troopName]) {
                message += member.name + ' is Rushed (' + TROOP_NAMES[troopName] + ' is ' + playerTroops[troopName] + ').\n';
            }
        }
        for(var spellName in SPELL_NAMES) {
            if (playerSpells[spellName]  < maxSpells[spellName]) {
                message += member.name + ' is Rushed (' + SPELL_NAMES[spellName] + ' is ' + playerSpells[spellName] + ').\n';
            }
        }
    }
    return message;
}

function dateComparator(member1, member2) {
    mem1Date = moment(member1.joinDate);
    mem2Date = moment(member2.joinDate);
    if (mem1Date.isAfter(mem2Date)) return 1;
    if (mem2Date.isAfter(mem1Date)) return -1;
    return 0;
}

function announceUpgrades() {
    logger.info('Started thread for announcing upgrades.');
    //Clear all player data before proceeding.
    playerList = [];
    models.PlayerData.findAll().then( currentMembers => {
        currentMembers.forEach( currentMember => {
            if (currentMember.inClan)
                loadMemberQueue.push(currentMember.tag);
        });
    });
}

function checkRushed(memberNames){
    setTimeout(function() {
        memberNames.forEach(memberName => {
            rushed(BOT_ANNOUNCE_CHANNELID, [memberName], true);
        });
    }, 10);
}

function _announceUpgrades() {
    //This will be called after all the player data has been loaded from Clash API.
    models.PlayerData.findAll({ include: [{ all: true }]}).then(currentMembers => {
        var message = '';
        var thUpgradedMembers = [];
        currentMembers.forEach( currentMemberData => {
            logger.info('Comparing data for - ' + currentMemberData.name);

            var latestDataForMember = playersMap[currentMemberData.tag];
            if (!latestDataForMember) {
                logger.warn('Latest data not found for player - ' + currentMemberData.tag);
                return;
            }
            var latestTroops = latestDataForMember.Troops;
            var latestSpells = latestDataForMember.Spells;
            var upgraded = false;
            var troopUpdates = {};
            var spellUpdates = {};
            if (latestDataForMember.townhallLevel > currentMemberData.townhallLevel) {
                upgraded = true;
                message += '' + currentMemberData.name + ' upgraded to Town Hall ' + latestDataForMember.townhallLevel + '\n';
                thUpgradedMembers.push(currentMemberData.name);
            }
            for(var troopName in TROOP_NAMES) {
                if (latestTroops[troopName] > currentMemberData.Troops[troopName]) {
                    if (currentMemberData.Troops[troopName] == 0) 
                        message += '' + currentMemberData.name + ' unlocked ' + TROOP_NAMES[troopName] + '\n';
                    else {
                        for(var i=currentMemberData.Troops[troopName]+1; i<=latestTroops[troopName]; i++) {
                            message += '' + currentMemberData.name + ' upgraded ' + TROOP_NAMES[troopName] + ' to lvl ' + i + '\n';
                        }
                    }
                    upgraded = true;
                    troopUpdates[troopName] = latestTroops[troopName];
                }
            }
            logger.debug('Troop Upgrades for ' + currentMemberData.name + ": " + troopUpdates);
            for(var spellName in SPELL_NAMES) {
                if (latestSpells[spellName] > currentMemberData.Spells[spellName]) {
                    if (currentMemberData.Spells[spellName] == 0) 
                        message += '' + currentMemberData.name + ' unlocked ' + SPELL_NAMES[spellName] + '\n';
                    else {
                        for(var i=currentMemberData.Spells[spellName]+1; i<=latestSpells[spellName]; i++) {
                            message += '' + currentMemberData.name + ' upgraded ' + SPELL_NAMES[spellName] + ' to lvl ' + i + '\n';
                        }
                    }
                    upgraded = true;
                    spellUpdates[spellName] = latestSpells[spellName];
                }
            }
            logger.info('DE Farmed by ' + currentMemberData.name + ': ' + (latestDataForMember.heroicHeist - currentMemberData.heroicHeist))
            if (upgraded) {
                var updates = {};
                updates.donationsReceived = latestDataForMember.donationsReceived;
                updates.trophies = latestDataForMember.trophies;
                updates.name = latestDataForMember.name;
                updates.townhallLevel = latestDataForMember.townhallLevel;
                updates.goldGrab = latestDataForMember.goldGrab;
                updates.elixirEscapade = latestDataForMember.elixirEscapade;
                updates.donations = latestDataForMember.donations;
                updates.heroicHeist = latestDataForMember.heroicHeist;

                currentMemberData.Troops.update(troopUpdates);
                currentMemberData.Spells.update(spellUpdates);
                currentMemberData.update(updates);
                logger.info('Saving the new Object for - ' + currentMemberData.name);
            } else {
                logger.info('No upgrades for - ' + currentMemberData.name);
            }

            if ( (message.match(/\n/g) || []).length > 30 && !MAINTENANCE) {
                logger.info('Announcing upgrades Part: ' + message);
                var tmpMessage = message;
                message = '';
                bot.sendMessage({
                    to: BOT_ANNOUNCE_CHANNELID,
                    embed: {
                        color: 13683174,
                        description: '' + tmpMessage + '',
                        footer: {
                            text: ''
                        },
                        thumbnail: {
                            url: ''
                        },
                        title: 'Upgrades',
                        url: ''
                    }
                });
            }
        });
        logger.info('Announcing upgrades Final: ' + message);
        logger.info('Following members upgraded TH: ' + thUpgradedMembers);
        checkRushed(thUpgradedMembers);
        if ( message != '' && !MAINTENANCE) {
            var tmpMessage = message;
            message = '';
            bot.sendMessage({
                to: BOT_ANNOUNCE_CHANNELID,
                embed: {
                    color: 13683174,
                    description: '' + tmpMessage + '',
                    footer: {
                        text: ''
                    },
                    thumbnail: {
                        url: ''
                    },
                    title: 'Upgrades',
                    url: ''
                }
            });
        }
        message = '';
        //Clear the map after processing is completed.
        playersMap = {};
    });
}

function checkNewMembers() {
    //var channelID = this.channelID;
    models.PlayerData.findAll().then( currentMembers => {
        var currentMembersMap = convertToMap(currentMembers);
        logger.info('Found ' + currentMembers.length + ' members.');

        if (currentMembers.length == 0) {
            seedMembers();
        } else {
            getCurrentData( liveMembers => {
                var message = '';
                var newMembers = 0;
                var membersLeft = 0;
                for (var memberTag in liveMembers) {
                    var liveMember = liveMembers[memberTag];
                    if (memberTag in currentMembersMap) {
                        if (currentMembersMap[memberTag].inClan) {
                            if (currentMembersMap[memberTag].clan != liveMember.clan) {
                                currentMembersMap[memberTag].clan = liveMember.clan
                                currentMembersMap[memberTag].save({fields: ['clan']});
                                message += liveMember.name + ' hopped over to ' + CLAN_NAMES[liveMember.clan] + '.\n';
                            }
                            delete currentMembersMap[memberTag];
                        } else {
                            newMembers++;
                            var now = new Date();
                            var leaveDate = new Date();
                            if (currentMembersMap[memberTag].leaveDate) 
                                leaveDate = moment(currentMembersMap[memberTag].leaveDate);
                            var daysAway = moment(now).diff(leaveDate, 'days');
                            if (daysAway <= MAX_AWAY_DAYS) {
                                message += liveMember.name + ' re-joined us in **'+ CLAN_NAMES[liveMember.clan] +'**!\n';
                            } else {
                                message += liveMember.name + ' re-joined us after ' + daysAway + ' days in **'+CLAN_NAMES[liveMember.clan]+'!\n';
                                currentMembersMap[memberTag].joinDate = now;
                            }
                            currentMembersMap[memberTag].inClan = true;
                            currentMembersMap[memberTag].leaveDate = null;
                            currentMembersMap[memberTag].clan = liveMember.clan
                            currentMembersMap[memberTag].save({fields: ['inClan', 'joinDate', 'leaveDate', 'clan']});
                            delete currentMembersMap[memberTag];
                        }
                    } else {
                        newMembers++;
                        message += liveMember.name + ' joined us in **'+CLAN_NAMES[liveMember.clan]+'** !\n';
                        saveMemberQueue.push(memberTag);
                    }
                }
                if ( Object.keys(currentMembersMap).length > 0 ) {
                    for(var memberTag in currentMembersMap) {
                        currentMember = currentMembersMap[memberTag];
                        if (currentMember.inClan) {
                            membersLeft++;
                            message += currentMember.name + ' is no longer with us.\n';
                        }
                        currentMember.leaveDate = new Date();
                        currentMember.inClan = false;
                        currentMember.save({fields: ['inClan']});
                    }
                }
                if (message != '') {
                    logger.debug(message);
                    bot.sendMessage({
                        to: BOT_ANNOUNCE_CHANNELID,
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
                logger.info('' + newMembers + ' joined the clan; ' + membersLeft + ' left the clan');
            });
        }
    });
}


function convertToMap(membersList) {
    var membersMap = {};
    membersList.forEach(member => {
        membersMap[member.tag] = member;
    });
    return membersMap;
}


/**
 * Fetches all the current details of the given player. If a result holder is passed,
 * the resulting player object is added to the list. Else the data is saved in database.
 */
function _fetchAndSaveMember(playerTag, resultHolder, callback) {
    logger.debug('Fetching data for memberTag - ' + playerTag);
    clashapi.getJoinDate(playerTag, CLAN_TAGS, function(err, joinDate) {
        if (err) {
            joinDate = new Date();
        }
        clashapi.getPlayerInfo(playerTag, function(perr, playerInfo) {
            if (perr) {
                logger.info('Error fetching player info. - ' + playerTag);
                callback();
                return;
            }
            player = models.PlayerData.build({tag: playerInfo.tag});
            troops = models.Troops.build({playerTag: playerInfo.tag})
            spells = models.Spells.build({playerTag: playerInfo.tag})
            player.donationsReceived = playerInfo.donationsReceived;
            player.trophies = playerInfo.trophies;
            player.name = playerInfo.name;
            player.townhallLevel = playerInfo.townHallLevel;
            player.joinDate = joinDate;
            if (playerInfo.clan)
                player.clan = playerInfo.clan.tag;

            playerInfo.achievements.forEach( achievement => {
                switch(achievement.name) {
                    case 'Gold Grab':
                        player.goldGrab = achievement.value;
                        break;
                    case 'Elixir Escapade':
                        player.elixirEscapade = achievement.value;
                        break;
                    case 'Friend in Need':
                        player.donations = achievement.value;
                        break;
                    case 'Heroic Heist':
                        player.heroicHeist = achievement.value;
                        break;
                    default:
                        break;
                }
            });
            playerInfo.troops.forEach( troop => {
                if (troop.village == 'builderBase') return;
                switch(troop.name) {
                    case 'Barbarian': troops.barbarian = troop.level; break;
                    case 'Archer': troops.archer = troop.level; break;
                    case 'Goblin': troops.goblin = troop.level; break;
                    case 'Giant': troops.giant = troop.level; break;
                    case 'Wall Breaker': troops.wallbreaker = troop.level; break;
                    case 'Balloon': troops.balloon = troop.level; break;
                    case 'Wizard': troops.wizard = troop.level; break;
                    case 'Healer': troops.healer = troop.level; break;
                    case 'Dragon': troops.dragon = troop.level; break;
                    case 'P.E.K.K.A': troops.pekka = troop.level; break;
                    case 'Baby Dragon': troops.babydragon = troop.level; break;
                    case 'Miner': troops.miner = troop.level; break;
                    case 'Electro Dragon': troops.electrodragon = troop.level; break;
                    //Dark Troops
                    case 'Minion': troops.minion = troop.level; break;
                    case 'Hog Rider': troops.hogrider = troop.level; break;
                    case 'Valkyrie': troops.valkyrie = troop.level; break;
                    case 'Golem': troops.golem = troop.level; break;
                    case 'Witch': troops.witch = troop.level; break;
                    case 'Lava Hound': troops.lavahound = troop.level; break;
                    case 'Bowler': troops.bowler = troop.level; break;
                    case 'Ice Golem': troops.icegolem = troop.level; break;
                }
            });
            if ('heroes' in playerInfo) {
                playerInfo.heroes.forEach( hero => {
                    switch(hero.name) {
                        case 'Barbarian King': troops.barbarianKing = hero.level; break;
                        case 'Archer Queen': troops.archerQueen = hero.level; break;
                        case 'Grand Warden': troops.grandWarden = hero.level; break;
                    }
                });
            }
            if ('spells' in playerInfo) {
                playerInfo.spells.forEach( spell => {
                    switch(spell.name) {
                        case 'Lightning Spell': spells.lightning = spell.level; break;
                        case 'Healing Spell': spells.heal = spell.level; break;
                        case 'Rage Spell': spells.rage = spell.level; break;
                        case 'Jump Spell': spells.jump = spell.level; break;
                        case 'Freeze Spell': spells.freeze = spell.level; break;
                        case 'Poison Spell': spells.poison = spell.level; break;
                        case 'Earthquake Spell': spells.earthquake = spell.level; break;
                        case 'Haste Spell': spells.haste = spell.level; break;
                        case 'Clone Spell': spells.clone = spell.level; break;
                        case 'Skeleton Spell': spells.skeleton = spell.level; break;
                        case 'Bat Spell': spells.bat = spell.level; break;
                    }
                });
            }

            if (resultHolder != null) {
                player.Troops = troops;
                player.Spells = spells;
                resultHolder[player.tag] = player;
                callback();
            } else {
                player.setTroops(troops);
                player.setSpells(spells);
                masterRosterQueue.push(player);
                player.save().then(() => {
                    callback();
                }).catch(error => {
                    logger.error('Error occured saving PlayerData for ' + playerInfo.tag);
                    logger.error(error);
                    callback();
                });
            }
        });
    });
}

function addMemberToMasterRoster(player, callback) {
    if (arguments.length == 0) {
        player = this.player;
    }
    authorize(googleCredentials, (auth) => {
        const sheets = google.sheets({version: 'v4', auth});

        sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'ROSTER!A2:A150',
        }, (err, res) => {
            if (err) {
                console.log("Error while fetching player tags from Master Roster.")
                console.log(err);
                callback();
            } else {
                var playerTags = res.data.values;
                var nextIndex = playerTags.length+2;
                var newMemberRow = [ 
                    player.tag,
                    player.name,
                    player.joinDate,
                    "",
                    player.townhallLevel,
                    player.clan,
                ];
                logger.info("Adding '" + player.name + "' to Master Roster!")                
                sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: 'ROSTER!A'+nextIndex+':F'+nextIndex,
                    valueInputOption: 'USER_ENTERED',
                    resource: {
                        values: [newMemberRow]
                    }
                }, (err, res) => {
                    if(err) 
                        console.log(err);
                    if(callback)
                        callback();
                });
            }
        });
    });
}

function seedMembers() {
    logger.info("Seeding initial data!");
    getCurrentData(liveMembers => {
        logger.info('Found ' + liveMembers.length + ' members for seeding');
        for(var memberTag in liveMembers) {
            saveMemberQueue.push(memberTag);
        }
    });
}

function getCurrentData(callback) {
    clashapi.getClanInfosNew(CLAN_TAGS, function(err, clanInfos) {
        if (err) {
            logger.warn('Error fetching Clan info');
            return;
        }
        var liveData = {};
        for(var clanTag in clanInfos) {
            var clanInfo = clanInfos[clanTag];
            if (clanInfo == null) {
                logger.warn('Missing clan member details for clan "' + clanTag + '"');
                continue;
            }            
            var members = clanInfo.memberList;
            members.forEach(member => {
                playerAttribMap = {
                    "donationsReceived": member.donationsReceived,
                    "trophies": member.trophies,
                    "tag": member.tag,
                    "name": member.name,
                    "clan": clanTag,
                }
                var player = models.PlayerData.build(playerAttribMap);
                liveData[member.tag] = player;
            });
        }
        callback(liveData);
    });
}

function _fetchResearchData(troopName, callback) {
    var url = RESEARCH_DATA_BASEURL + troopName.replace(" ","_");
    if (troopName == 'Baby Dragon') 
        url = RESEARCH_DATA_BASEURL + 'Baby_Dragon/Home_Village';

    axios.get(url).then(response => {
        _loadResearchData(response.data);
        callback();
    }).catch(function (err) {
        logger.error('Error for ' + troopName + ': ' + err);
        callback();
    });
}

function _loadResearchData(html) {
    const $ = cheerio.load(html);

    var troopName = $('h1.page-header__title').text();
    if (troopName.indexOf('/')) troopName = troopName.split('/')[0];
    
    var tables = $('.wikitable');
    
    for(var i=0; i<tables.length; i++) {
        var table = tables[i];
        //                 TABLE   TBODY               TR                TH/TD
        var innerHtml = $(table).children().first().children().first().children().first().text();
        if (innerHtml.indexOf("Level") < 0) continue;
        rows = $(table).children().first().children();
        var levelCol = 0;
        var researchCostCol = -1;
        var researchTimeCol = -1;
        var headers = $(rows[0]).children();
        var resource = 'Elixir';
        for(var j=0; j<headers.length; j++) {
            if ($(headers[j]).text().indexOf('Research Cost') > -1) {
                researchCostCol = j;
                continue;
            }
            if ($(headers[j]).text().indexOf('Upgrade Cost') > -1 && researchCostCol == -1) {
                researchCostCol = j;
                continue;
            }
            if ($(headers[j]).text().indexOf('Upgrading Cost') > -1 && researchCostCol == -1) {
                researchCostCol = j;
                continue;
            }
            if ($(headers[j]).text().indexOf('Training Cost') > -1 && researchCostCol == -1) {
                researchCostCol = j;
                continue;
            }
            if ($(headers[j]).text().indexOf('Research Time') > -1) {
                researchTimeCol = j;
                continue;
            }
            if ($(headers[j]).text().indexOf('Upgrade') > -1 && researchTimeCol == -1) {
                researchTimeCol = j;
                continue;
            }
            if ($(headers[j]).text().indexOf('Upgrading Time') > -1 && researchTimeCol == -1) {
                researchTimeCol = j;
                continue;
            }
            if ($(headers[j]).text().indexOf('Training Time') > -1 && researchTimeCol == -1) {
                researchTimeCol = j;
                continue;
            }
        }
        if ($(headers[researchCostCol]).text().indexOf('Dark') > -1) {
            resource = 'DE';
        }
        for(var j=1; j<rows.length; j++){
            var cost = parseInt(strip($($(rows[j]).children()[researchCostCol]).text()), 10);
            if (resource == 'DE')
                cost = (cost/1000) + 'k';
            else
                cost = (cost/1000000) + 'm';
            var upgData = {
                level: strip($($(rows[j]).children()[levelCol]).text()),
                cost: cost,
                time: strip($($(rows[j]).children()[researchTimeCol]).text()),
                resource: resource
            };
            RESEARCH_DATA[troopName+'-'+upgData.level] = upgData;
        }
        break;
    }
}  

function handleReaction(channelID, messageID, emoji, add) {
    models.CwlRsvp.findOne({
        where: models.sequelize.or( {firstquestion: messageID}, {secondquestion: messageID})
    }).then(cwlRsvp => {
        if (!cwlRsvp) return;
        if (messageID == cwlRsvp.firstquestion) {
            if (emoji == "✅")
                cwlRsvp.firstquestionanswer = add ? "Y" : null;
            if (emoji == "❎")
                cwlRsvp.firstquestionanswer = add ? "N" : null;
            cwlRsvp.save({fields: ["firstquestionanswer"]});
        } else if (messageID == cwlRsvp.secondquestion) {
            var previousAnswer = cwlRsvp.secondquestionanswer==null ? "" : cwlRsvp.secondquestionanswer;
            previousAnswerArr = previousAnswer.split(",");
            var value = null;
            switch(emoji) {
                case "🇦": 
                    value = "A"; break;
                case "1⃣":
                    value = "1"; break;
                case "2⃣":
                    value = "2"; break;
                case "3⃣":
                    value = "3"; break;
                case "4⃣":
                    value = "4"; break;
                case "5⃣":
                    value = "5"; break;
                case "6⃣":
                    value = "6"; break;
                case "7⃣":
                    value = "7"; break;
                case "🆗":
                    purgeCwlPoll(channelID, messageID); break;
            }
            if (value) {
                if (add) previousAnswerArr.push(value);
                else previousAnswerArr = previousAnswerArr.filter( (val, idx, arr) => {return val != value});
            }
            cwlRsvp.secondquestionanswer = previousAnswerArr.join(',');
            cwlRsvp.save({fields: ["secondquestionanswer"]});
        }
    });
}


const EXCL_CWL_COL = 9;
const EXCL_CWL_POLL_COL = 8;
const TOWNHALL_LEVEL_COL = 4;
const PLAYER_TAG_COL = 0;
const NAME_COL = 1;
const DISCORD_ID_COL = 3;

function cwlpoll(auth) {
    const sheets = google.sheets({version: 'v4', auth});

    POLL_STARTED = true;

    sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'ROSTER!A2:I150',
    }, (err, res) => {
        if(err) {
            logger.error("Google API Error: " + err);
            console.log(err);
            return;
        }
        data = res.data.values;
        data.forEach( row => {
            if (row[8] && row[8] == "X") return;
            if (row[3] && row[3].length > 1) {
                console.log("Sending Notification for - " + row[NAME_COL]);
                models.CwlRsvp.findByPk(row[PLAYER_TAG_COL]).then( cwlRsvp => {
                    if (!cwlRsvp) {
                        firstMessage(row[DISCORD_ID_COL], row[NAME_COL], row[PLAYER_TAG_COL], row[TOWNHALL_LEVEL_COL]);
                        secondMessage(row[DISCORD_ID_COL], row[NAME_COL], row[PLAYER_TAG_COL], row[TOWNHALL_LEVEL_COL]);                        
                    }
                });
            }
        });
    });
}

const botSendCommandQueue = new Queue();
const botReactionCommandQueue = new Queue();
const watchedMessageIds = new Set();
const deleteQueue = new Queue();
var POLL_STARTED = false;
var PURGE_STARTED = false;

//Dequeue sendCommands - Once every 15secs.
setInterval(function() {
    command = botSendCommandQueue.dequeue();
    if (command) {
        bot.sendMessage(command.input, command.callback);
        logger.info("Pending Send Messages Commands: " + botSendCommandQueue.getLength());
    } else {
        if (POLL_STARTED) {
            bot.sendMessage({
                to: BOT_ANNOUNCE_CHANNELID,
                message: 'Finished sending CWL Poll DMs.'
            });
        }
        POLL_STARTED = false;
    }

}, 15000);

//Dequeue reaction command - once every second
setInterval(function() {
    command = botReactionCommandQueue.dequeue();
    if (command) {
        bot.addReaction(command.input);
        console.log("Pending Reaction Commands: " + botReactionCommandQueue.getLength());
    }
}, 1000);

//Dequeue Delete Command - once every 1.5 secs
setInterval(function() {
    var input = deleteQueue.dequeue();
    if (input) {
        bot.deleteMessage(input);
        console.log("Pending : " + deleteQueue.getLength());
    } else {
        if (PURGE_STARTED) {
            bot.sendMessage({
                to: BOT_ANNOUNCE_CHANNELID,
                message: 'Finished purging of CWL Poll DMs.'
            });
        } 
        PURGE_STARTED = false;
    }
}, 1500);


function firstMessage(discordUserId, name, playerTag, townhallLevel) {
    var playerStr = name+'-('+playerTag+')-TH'+townhallLevel;
    var cmdInput = {
        to: discordUserId,
        embed: {
            color: 13683174,
            description: 'CWL for October is starting on the 1st of October.',
            footer: { 
                text: '© Almost Divorced Clan'
            },
            thumbnail: {
                url: ''
            },
            title: '  ⚔ Clan War Leagues ⚔  RSVP',
            fields: [{
                name: 'First Battle Day is October 2nd',
                value: '`⚔`'
            }, {
                name: 'Will   '+playerStr+'   be participating?',
                value: '`✅ = Yes      ❎ = No`'
            }]
        }
    };

    botSendCommandQueue.enqueue({command: "sendMessage", input: cmdInput, 
        callback: handleFirstQuestionCallback.bind({playerTag: playerTag, discordUserId: discordUserId})
    });
}

ALL_VALID_REACTIONS = new Set(["✅", "❎", "🇦", "1⃣", "2⃣", "3⃣", "4⃣", "5⃣", "6⃣", "7⃣", "🆗"]);
Q1_REACTIONS = ["✅", "❎"];

function handleFirstQuestionCallback(err, res) {
    const playerTag = this.playerTag;
    const discordUserId = this.discordUserId;
    const messageID = res.id;
    const channelID = res.channel_id;
    watchedMessageIds.add(messageID);
    // Save in database to handle service restarts.
    models.CwlRsvp.findByPk(playerTag).then(cwlRsvp => {
        if (cwlRsvp) {
            cwlRsvp.firstquestion = messageID;
        } else {
            cwlRsvp = models.CwlRsvp.build({playertag: playerTag});
            cwlRsvp.channelid = channelID;
            cwlRsvp.firstquestion = messageID;
        }
        cwlRsvp.save().then( function() {
            Q1_REACTIONS.forEach(aReaction => {
                var reactionInput = {
                    channelID: channelID,
                    messageID: messageID,
                    reaction: aReaction
                };
                botReactionCommandQueue.enqueue({command: "addReaction", input: reactionInput});
            });
        });
    });
}

function secondMessage(discordUserId, name, playerTag, townhallLevel) {
    var playerStr = name+'-('+playerTag+')-TH'+townhallLevel;
    var cmdInput = {
        to: discordUserId,
        embed: {
            color: 13683174,
            description: 'Select the days you will attend. 🇦 = All Days.',
            footer: { 
                text: '© Almost Divorced Clan'
            },
            thumbnail: {
                url: ''
            },
            title: ' Which days will '+playerStr+' be attending? ',
            fields: [{
                name: 'Confirmation',
                value: 'After completing your choice, please click 🆗 to confirm!'
            }]
        }
    };

    botSendCommandQueue.enqueue({command: "sendMessage", input: cmdInput, 
        callback: handleSecondQuestionCallback.bind({playerTag: playerTag, discordUserId: discordUserId})
    });
   
}

const Q2_REACTIONS = ["🇦", "1⃣", "2⃣", "3⃣", "4⃣", "5⃣", "6⃣", "7⃣", "🆗"];

function handleSecondQuestionCallback(err, res) {
    const playerTag = this.playerTag;
    const discordUserId = this.discordUserId;
    const messageID = res.id;
    const channelID = res.channel_id;
    watchedMessageIds.add(messageID);
    // Save in database to handle service restarts.
    models.CwlRsvp.findByPk(playerTag).then(cwlRsvp => {
        cwlRsvp.secondquestion = messageID;
        cwlRsvp.save({fields: ['secondquestion']}).then( function() {
            Q2_REACTIONS.forEach(aReaction => {
                var reactionInput = {
                    channelID: channelID,
                    messageID: messageID,
                    reaction: aReaction
                };
                botReactionCommandQueue.enqueue({command: "addReaction", input: reactionInput});
            });
        });
    });
}

function uploadcwldata() {
    authorize(googleCredentials, (auth) => {
        const sheets = google.sheets({version: 'v4', auth});

        sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'ROSTER!A2:J150',
        }, (err, res) => {
            if(err) {
                logger.error("Google API Error: " + err);
                console.log(err);
                return;
            }
            roster = res.data.values;
            models.CwlRsvp.findAll().then( cwlRsvps => {
                var cwldata = [];
                if (cwlRsvps.length == 0) return;
                roster.forEach( rosterRow => {
                    if (rosterRow[EXCL_CWL_COL] && rosterRow[EXCL_CWL_COL] == 'X') {
                        //This means player is excluded from CWL.
                        return;
                    } else  if (!rosterRow[EXCL_CWL_COL] || rosterRow[EXCL_CWL_COL]=="") {
                        if (rosterRow[EXCL_CWL_POLL_COL] && rosterRow[EXCL_CWL_POLL_COL]=="X") {
                            //This means poll is not needed. Player is automatically included in CWL.
                            cwldata.push({
                                tag: rosterRow[PLAYER_TAG_COL], 
                                townhallLevel: rosterRow[TOWNHALL_LEVEL_COL],
                                rsvp: "Y", days: "A"
                            });
                        } else if (!rosterRow[EXCL_CWL_POLL_COL] || rosterRow[EXCL_CWL_POLL_COL]=="") {
                            //Need to check poll data;
                            var cwlRsvp = _getCwlRsvp(cwlRsvps, rosterRow[PLAYER_TAG_COL]);
                            var rsvp = '';
                            var rsvpResponse = '';
                            if (cwlRsvp && cwlRsvp.firstquestionanswer && cwlRsvp.firstquestionanswer != "") 
                                rsvp = cwlRsvp.firstquestionanswer;
                            if (cwlRsvp && cwlRsvp.secondquestionanswer && cwlRsvp.secondquestionanswer != "")
                                rsvpResponse = cwlRsvp.secondquestionanswer;
                            cwldata.push({
                                tag: rosterRow[PLAYER_TAG_COL], 
                                townhallLevel: rosterRow[TOWNHALL_LEVEL_COL],
                                rsvp: rsvp, days: rsvpResponse,
                            });
                        }
                    }
                }); 

                var tags = [];
                var daysAttending = [];
                cwldata = cwldata.sort( (data1, data2) => {
                    // if (data1.townhallLevel == data2.townhallLevel)
                    //     return data1.tag > data2.tag;
                    return (data2.townhallLevel - data1.townhallLevel);
                });
                cwldata.forEach( cwldataobj => {
                    tags.push([cwldataobj.rsvp, cwldataobj.days, cwldataobj.tag]);
                    var daysAttendingRow = ['Q','Q','Q','Q','Q','Q','Q'];
                    if (cwldataobj.rsvp == 'N') {
                        daysAttendingRow = ['-','-','-','-','-','-','-'];
                    } else {
                        if (cwldataobj.days.indexOf('A') < 0) {
                            if (cwldataobj.days.indexOf('1') < 0) daysAttendingRow[0] = "-";
                            if (cwldataobj.days.indexOf('2') < 0) daysAttendingRow[1] = "-";
                            if (cwldataobj.days.indexOf('3') < 0) daysAttendingRow[2] = "-";
                            if (cwldataobj.days.indexOf('4') < 0) daysAttendingRow[3] = "-";
                            if (cwldataobj.days.indexOf('5') < 0) daysAttendingRow[4] = "-";
                            if (cwldataobj.days.indexOf('6') < 0) daysAttendingRow[5] = "-";
                            if (cwldataobj.days.indexOf('7') < 0) daysAttendingRow[6] = "-";
                        }                        
                    }

                    daysAttending.push(daysAttendingRow);
                });

                var cwlUpdateData = [];
                cwlUpdateData.push({range: 'CWL LIST!A5:C' + tags.length+5, values: tags});
                cwlUpdateData.push({range: 'CWL LIST!F5:L' + tags.length+5, values: daysAttending});

                sheets.spreadsheets.values.batchUpdate({
                    spreadsheetId: SPREADSHEET_ID,
                    resource: {
                        data: cwlUpdateData,
                        valueInputOption: 'USER_ENTERED'
                    }
                }, (err, res) => {
                    if (err) {
                        console.log(err);
                        return;
                    }
                    console.log("Successfully Uploaded Data");
                });

            });
        });
    });
}


function purgeCwlPoll(channelID, messageID) {
    if (channelID) {
        models.CwlRsvp.findOne({where: {secondquestion: messageID, channelid: channelID}}).then(cwlRsvp => {
            if (!cwlRsvp) return;
            deleteQueue.enqueue({channelID: channelID, messageID: cwlRsvp.firstquestion});
            deleteQueue.enqueue({channelID: channelID, messageID: cwlRsvp.secondquestion});
        });                        
    } else {
        PURGE_STARTED = true;
        models.CwlRsvp.findAll().then( cwlRsvps => {
            cwlRsvps.forEach(cwlRsvp => {
                var channelID = cwlRsvp.channelid;
                sleep(1000).then(() => {
                    bot.getMessages({
                        channelID: channelID
                    }, (err, response) => {
                        if (err) return;
                        message_ids = [];
                        response.forEach( message => {
                            if (message.author.id == BOT_CONFIGS.botUserId) {
                                deleteQueue.enqueue({
                                    channelID: channelID,
                                    messageID: message.id
                                });
                            }
                        });
                    });
                });
            });
        });
    }
}

function _getCwlRsvp(cwlRsvpList, playerTag) {
    for(var i=0; i<cwlRsvpList.length; i++) {
        if (cwlRsvpList[i].playertag == playerTag) return cwlRsvpList[i];
    }
    return null;
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
