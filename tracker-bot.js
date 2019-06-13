var logger = require('./utils/logger.js');
var models = require('./model/clashmodels.js');
var clashapi = require('./utils/clashapi.js')
var Discord = require('discord.io');
var async = require('async');
var scheduler = require('node-schedule');


const discordAuth = require(process.env.CONFIGS_DIR + '/discord-auth.json');
const BOT_CONFIGS = require(process.env.CONFIGS_DIR + '/tracker-bot-configs.json');

const CLAN_TAG = BOT_CONFIGS.thisClanTag;
const ALMOST_DIVORCED_SERVER_ID = BOT_CONFIGS.discordServerId;
const BOT_ANNOUNCE_CHANNELID = BOT_CONFIGS.defaultChannelId;
const MAX_TROOPS = {};
const MAX_SPELLS = {};

const MAINTENANCE = false;

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
    pekka: 'Pekka',
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
    lightning: 'Lightning',
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

// saveMemberQueue.drain = _announceUpgrades;

loadMemberQueue.drain = _announceUpgrades;


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
    // setInterval(function() {
    //     checkNewMembers();
    // }, 30000);
    //setTimeout(announceUpgrades, 4000);
    // scheduler.scheduleJob('0 0,8,12,16,20 * * *', announceUpgrades);
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
                rushed(channelID);
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

function rushed(channelID) {
    // models.PlayerData.findAll({include: [{model: models.Troops, as: 'Troops'}, {model: models.Spells, as: 'Spells'}]}).then(currentMembers => {
    models.PlayerData.findAll({ include: [{ all: true }]}).then(currentMembers => {
        var message = '';
        var lines = 0;
        var none = true;
        currentMembers.forEach( member => {
            if (member.townhallLevel > 1) {
                var maxTroops = MAX_TROOPS[member.townhallLevel-1];
                var maxSpells = MAX_SPELLS[member.townhallLevel-1];

                var playerTroops = member.Troops;
                var playerSpells = member.Spells;

                for(var troopName in TROOP_NAMES) {
                    if (playerTroops[troopName]  < maxTroops[troopName]) {
                        message += member.name + ' is Rushed (' + TROOP_NAMES[troopName] + ' is low).\n';
                        lines++;
                    }
                }
                for(var spellName in SPELL_NAMES) {
                    if (playerSpells[spellName]  < maxSpells[spellName]) {
                        message += member.name + ' is Rushed (' + SPELL_NAMES[spellName] + ' is low).\n';
                        lines++;
                    }
                }
            }
            if (lines >= 50) {
                var message_part = message;
                message = '';
                lines = 0;
                none = false;
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
                        title: 'Rushed members',
                        url: ''
                    }
                });
            }
        });
        if (message == '') {
            if (none)
                message = 'None!';
            else
                return;
        }
        bot.sendMessage({
            to: channelID,
            embed: {
                color: 13683174,
                description: '' + message + '',
                footer: {
                    text: ''
                },
                thumbnail: {
                    url: ''
                },
                title: 'Rushed members',
                url: ''
            }
        });
    })
}


function announceUpgrades() {
    logger.info('Started thread for announcing upgrades.');
    //Clear all player data before proceeding.
    playerList = [];
    models.PlayerData.findAll().then( currentMembers => {
        currentMembers.forEach( currentMember => {
            loadMemberQueue.push(currentMember.tag);
        });
    });
}

function _announceUpgrades() {
    //This will be called after all the player data has been loaded from Clash API.
    models.PlayerData.findAll({ include: [{ all: true }]}).then(currentMembers => {
        var message = '';
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
            for(var troopName in TROOP_NAMES) {
                if (latestTroops[troopName] > currentMemberData.Troops[troopName]) {
                    message += '' + currentMemberData.name + ' upgraded ' + TROOP_NAMES[troopName] + ' to lvl ' + latestTroops[troopName] + '\n';
                    upgraded = true;
                }
                currentMemberData.Troops[troopName] = latestTroops[troopName];
            }
            for(var spellName in SPELL_NAMES) {
                if (latestSpells[spellName] > currentMemberData.Spells[spellName]) {
                    message += '' + currentMemberData.name + ' upgraded ' + SPELL_NAMES[spellName] + ' to lvl ' + latestSpells[spellName] + '\n';
                    upgraded = true;
                }
                currentMemberData.Spells[spellName] = latestSpells[spellName];
            }
            logger.info('DE Farmed by ' + currentMemberData.name + ': ' + (latestDataForMember.heroicHeist - currentMemberData.heroicHeist))
            if (upgraded) {
                currentMemberData.donationsReceived = latestDataForMember.donationsReceived;
                currentMemberData.trophies = latestDataForMember.trophies;
                currentMemberData.name = latestDataForMember.name;
                currentMemberData.townhallLevel = latestDataForMember.townHallLevel;
                currentMemberData.goldGrab = latestDataForMember.goldGrab;
                currentMemberData.elixirEscapade = latestDataForMember.elixirEscapade;
                currentMemberData.donations = latestDataForMember.donations;
                currentMemberData.heroicHeist = latestDataForMember.heroicHeist;

                currentMemberData.save();
                logger.info('Saving the new Object for - ' + currentMemberData.name);
            } else {
                logger.info('No upgrades for - ' + currentMemberData.name);
            }
        });
        logger.info('Announcing upgrades: ' + message);
        message = '';
        if ( message != '' ) {
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
                    title: 'Upgrades',
                    url: ''
                }
            });
        }
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
