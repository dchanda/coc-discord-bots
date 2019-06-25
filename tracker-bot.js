const logger = require('./utils/logger.js');
const models = require('./model/clashmodels.js');
const clashapi = require('./utils/clashapi.js')
const Discord = require('discord.io');
const async = require('async');
const scheduler = require('node-schedule');
const moment = require('moment-timezone');
const axios = require('axios');
const cheerio = require('cheerio');

const discordAuth = require(process.env.CONFIGS_DIR + '/discord-auth.json');
const BOT_CONFIGS = require(process.env.CONFIGS_DIR + '/tracker-bot-configs.json');
const RESEARCH_DATA_BASEURL = 'https://clashofclans.fandom.com/wiki/';

const CLAN_BIRTHDAY = moment('28 Dec 2018','DD MMM YYYY');

const RESEARCH_DATA = {};
const CLAN_TAG = BOT_CONFIGS.thisClanTag;
const ALMOST_DIVORCED_SERVER_ID = BOT_CONFIGS.discordServerId;
const BOT_ANNOUNCE_CHANNELID = BOT_CONFIGS.defaultChannelId;
const MAX_TROOPS = {};
const MAX_SPELLS = {};

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


// ---- GLOBAL VARIABLES -----
var playersMap = {};
var responseChannelId = null;

const saveMemberQueue = async.queue(function(memberTag, callback) {
    _fetchAndSaveMember(memberTag, null, callback);
}, 5);

const loadMemberQueue = async.queue(function(memberTag, callback) {
    _fetchAndSaveMember(memberTag, playersMap, callback);
}, 5);

const fetchResearchInfoQueue = async.queue(function(troopName, callback) {
    _fetchResearchData(troopName, callback);
}, 5);

// saveMemberQueue.drain = _announceUpgrades;

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
    cacheMaxLevels();
    cacheResearchData();
    setInterval(function() {
        checkNewMembers();
    }, 30000);
    // setTimeout(announceUpgrades, 2000);
    scheduler.scheduleJob('0 0,8,12,16,20 * * *', announceUpgrades);
    scheduler.scheduleJob('0 8 * * *', checkClanJoinDates);
});

bot.on('message', function (user, userID, channelID, message, evt) {
    console.log(message);
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
                researchInfo(channelID, args);
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
    if (today.isAfter(CLAN_BIRTHDAY.add(180, 'D')) && today.isBefore(CLAN_BIRTHDAY.add(181, 'D'))) {
        bot.sendMessage({
            to: BOT_ANNOUNCE_CHANNELID,
            message: '@everyone, Congratulations on 6 Month Anniversary! Good going!'
        });
    }
}


function researchInfo(channelID, args) {
    var memberName = null;
    if (args.length > 0) {memberName = args.join(' ');}
    else {
        bot.sendMessage({
            to: channelID,
            message: 'Need a player name of playerTag bud!'
        });
    }
    if ( memberName.startsWith('#') ) {
        where = {tag: memberName};
    } else {
        where = {name: memberName};
    }
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
        var maxTroops = MAX_TROOPS[member.townhallLevel];
        var maxSpells = MAX_SPELLS[member.townhallLevel];

        var playerTroops = member.Troops;
        var playerSpells = member.Spells;
        var message = '';
        var message_parts = [];
        var lineLimit = 20;
        for(var troopName in TROOP_NAMES) {
            var troopLevel = playerTroops[troopName];
            var troopDispName = TROOP_NAMES[troopName];
            if ( troopLevel < maxTroops[troopName]) {
                for(var i=troopLevel; i<maxTroops[troopName]; i++) {
                    var rsrcImage = '<:Elixir:592925068053577728>';
                    if (RESEARCH_DATA[troopDispName+'-'+(i+1)].resource == 'DE')
                        rsrcImage = '<:DE:592925323654594621>';
                    message += TROOP_NAMES[troopName] + ' lvl ' + i + ' to lvl ' + (i+1) + ' '
                            + rsrcImage + ': ' 
                            + RESEARCH_DATA[troopDispName+'-'+(i+1)].cost +  ';' + ' Time: ' 
                            + RESEARCH_DATA[troopDispName+'-'+(i+1)].time + '\n';
                    if ( (message.match(/\n/g) || []).length > lineLimit ) {
                        message_parts.push(message);
                        message = '';
                    }
                }
            }
        }
        for(var spellName in SPELL_NAMES) {
            var spellLevel = playerSpells[spellName];
            var spellDispName = SPELL_NAMES[spellName];
            if ( spellLevel < maxSpells[spellName]) {
                for(var i=spellLevel; i<maxSpells[spellName]; i++) {
                    var rsrcImage = '<:Elixir:592925068053577728>';
                    if (RESEARCH_DATA[spellDispName+'-'+(i+1)].resource == 'DE')
                        rsrcImage = '<:DE:592925323654594621>';
                    message += SPELL_NAMES[spellName] + ' lvl ' + i + ' to lvl ' + (i+1) + ' '
                            + rsrcImage + ': ' 
                            + RESEARCH_DATA[spellDispName+'-'+(i+1)].cost +  ';' + ' Time: ' 
                            + RESEARCH_DATA[spellDispName+'-'+(i+1)].time + '\n';
                    if ( (message.match(/\n/g) || []).length > lineLimit ) {
                        message_parts.push(message);
                        message = '';
                    }
                }
            }
        }
        if (message == '') message = 'All research completed!';
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
                    else 
                        message += '' + currentMemberData.name + ' upgraded ' + TROOP_NAMES[troopName] + ' to lvl ' + latestTroops[troopName] + '\n';
                    upgraded = true;
                    troopUpdates[troopName] = latestTroops[troopName];
                }
            }
            logger.debug('Troop Upgrades for ' + currentMemberData.name + ": " + troopUpdates);
            for(var spellName in SPELL_NAMES) {
                if (latestSpells[spellName] > currentMemberData.Spells[spellName]) {
                    if (currentMemberData.Spells[spellName] == 0) 
                        message += '' + currentMemberData.name + ' unlocked ' + SPELL_NAMES[spellName] + '\n';
                    else
                        message += '' + currentMemberData.name + ' upgraded ' + SPELL_NAMES[spellName] + ' to lvl ' + latestSpells[spellName] + '\n';
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
                            delete currentMembersMap[memberTag];
                        } else {
                            newMembers++;
                            message += liveMember.name + ' re-joined us!\n';
                            currentMembersMap[memberTag].inClan = true;
                            currentMembersMap[memberTag].save({fields: ['inClan']});
                            delete currentMembersMap[memberTag];
                        }
                    } else {
                        newMembers++;
                        message += liveMember.name + ' joined us!\n';
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
    clashapi.getJoinDate(playerTag, CLAN_TAG, function(err, joinDate) {
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
                player.save().then(function() {
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
    clashapi.getClanInfo(CLAN_TAG, function(err, clanInfo) {
        if (err) {
            logger.warn('Error fetching Clan info');
            return;
        }
        var members = clanInfo.memberList;
        var liveData = {};
        members.forEach(member => {
            playerAttribMap = {};
            playerAttribMap.donationsReceived = member.donationsReceived;
            playerAttribMap.trophies = member.trophies;
            playerAttribMap.tag = member.tag;
            playerAttribMap.name = member.name;
            var player = models.PlayerData.build(playerAttribMap);
            liveData[member.tag] = player;
        });
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
            if ($(headers[j]).text().indexOf('Training Time') > -1 && researchTimeCol == -1) {
                researchTimeCol = j;
                continue;
            }
        }
        console.log($(headers[researchCostCol]).text());
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
