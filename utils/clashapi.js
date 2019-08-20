var logger = require('./logger.js');
var RestClientLib = require('node-rest-client').Client;
var moment = require('moment-timezone');

const CLASH_CONFIG = require(process.env.CONFIGS_DIR + '/clash-token.json');

var restClient = new RestClientLib();


exports.getAttackSummary = getAttackSummary;
exports.getClanInfo = getClanInfo;
exports.getClanInfos = getClanInfos;
exports.getPlayerInfo = getPlayerInfo;
exports.getJoinDate = getJoinDate;

function getClanInfo(clanTag, callback) {
    var args = {
        path: {'clanTag': encodeURIComponent(clanTag)},
        headers: CLASH_CONFIG.auth
    };
    restClient.get(CLASH_CONFIG.urlPrefix + '/v1/clans/${clanTag}', args, function(responseJson, response) {
        if (response.statusCode != 200) {
            logger.warn('Clan information unavailable!');
            logger.debug('Response status Code: ' + response.statusCode);
            logger.debug('Response : ' + responseJson);
            callback({message: 'Clash API Error!',
                    code: response.statusCode}, 
                null);
            return;
        }
        var warEndTime = moment(responseJson);
        callback(null, responseJson);
    });
}

function getClanInfos(clanTags, callback) {
    var clanInfoHolder = {};

    clanTags.forEach(clanTag => {
        _getClanInfoInternal(clanTag, function(err, clanInfo) {
            clanInfoHolder[clanTag] = clanInfo;
            if (Object.keys(clanInfoHolder).length == clanTags.length) {
                callback(null, clanInfoHolder)
            }
        });
    });
}

function _getClanInfoInternal(clanTag, callback) {
    var args = {
        path: {'clanTag': encodeURIComponent(clanTag)},
        headers: CLASH_CONFIG.auth
    };
    restClient.get(CLASH_CONFIG.urlPrefix + '/v1/clans/${clanTag}', args, function(responseJson, response) {
        if (response.statusCode != 200) {
            logger.warn('Clan information unavailable!');
            logger.debug('Response status Code: ' + response.statusCode);
            logger.debug('Response : ' + responseJson);
            callback({message: 'Clash API Error!',
                    code: response.statusCode}, 
                null);
            return;
        }
        var warEndTime = moment(responseJson);
        callback(null, responseJson);
    });
}

function getPlayerInfo(playerTag, callback) {
    var args = {
        path: {'playerTag': encodeURIComponent(playerTag)},
        headers: CLASH_CONFIG.auth
    };
    restClient.get(CLASH_CONFIG.urlPrefix + '/v1/players/${playerTag}', args, function(responseJson, response) {
        if (response.statusCode != 200) {
            logger.warn('Player information unavailable.');
            logger.warn('Response status Code: ' + response.statusCode);
            logger.warn('Response : ' + responseJson);
            callback({message: 'Clash API Error!',
                    code: response.statusCode}, 
                null);
            return;
        }
        callback(null, responseJson);
    });    
}

function getJoinDate(playerTag, clanTags, callback) {
    var args = { path:{'playerTag': playerTag.substring(1)} };
    restClient.get('https://api.clashofstats.com/players/${playerTag}/history/clans', args, function(responseJson, response) {
        if (response.statusCode != 200) {
            logger.warn('Unable to fetch clan history from clashofstats for "' + playerTag + '": ' + response.statusCode);
            //logger.warn(responseJson);
            callback({message: 'Clash of Stats Error!',
                    code: response.statusCode}, null);
            return;
        }
        var joinDate = null; 
        responseJson.log.forEach( clanStay => {
            var tmpJoinDate;

            if (clanTags.includes(clanStay.tag)) {
                tmpJoinDate = moment(clanStay.start);
                if (joinDate == null) {
                    joinDate = tmpJoinDate;
                } else {
                    if (joinDate.isAfter(tmpJoinDate)) joinDate = tmpJoinDate;
                }
            }
        });
        if (joinDate != null)
            callback(null, joinDate.toDate());
        else 
            callback(null, new Date());
    });
}

function getAttackSummary(clanTag, opponentClanTag, callback) {
    var args = {
        path: {'clanTag': encodeURIComponent(opponentClanTag)},
        headers: CLASH_CONFIG.auth
    };

    var attackSummary = {};
    restClient.get(CLASH_CONFIG.urlPrefix + '/v1/clans/${clanTag}/currentwar', args, function(responseJson, response) {
        if (response.statusCode != 200) {
            logger.warn('Error fetching current war information!');
            logger.debug('Response status Code: ' + response.statusCode);
            logger.debug('Response : ' + responseJson);
            callback({message: 'Clash API Error! - War Log not public for Clan - ' + clanTag,
                code: response.statusCode}, 
                null);
            return;
        }
        
        var warEndTime = moment(responseJson.endTime);
        var now = moment();
        if (responseJson.state != 'inWar') {
            logger.info('War is in Preparation Phase. No attacks yet!');
            callback({
                message: 'Preperation Phase',
                code: 100,
                startTime: moment(responseJson.startTime)
            }, null);
            // callback('Preperation Phase', null);
            return;
        }

        var opponentMembers = responseJson.clan.members;
        var opponentMembersMapPosition = {};
        var baseStatus = [];
        opponentMembers = opponentMembers.sort(compareMembers);
        for(var i=0; i<opponentMembers.length; i++) {
            opponentMembersMapPosition[opponentMembers[i].tag] = opponentMembers[i].mapPosition;
            if ('bestOpponentAttack' in opponentMembers[i]) {
                baseStatus.push(opponentMembers[i].bestOpponentAttack.stars);
            } else 
                baseStatus.push(null);
        }
        attackSummary['baseStatus'] = baseStatus;

        var members = responseJson['opponent']['members'];
        members.map( (member) => {
            attackSummary[member.tag] = {};
            if (member.attacks) {
                attackSummary[member.tag]['attack1'] = {};
                attackSummary[member.tag]['attack1']['stars'] = member.attacks[0].stars;
                attackSummary[member.tag]['attack1']['base'] = opponentMembersMapPosition[member.attacks[0].defenderTag];
                if (member.attacks.length > 1) {
                    attackSummary[member.tag]['attack2'] = {};
                    attackSummary[member.tag]['attack2']['stars'] = member.attacks[1].stars;
                    attackSummary[member.tag]['attack2']['base'] = opponentMembersMapPosition[member.attacks[1].defenderTag];
                }
            }
        });

        callback(null, attackSummary);
    });
}

function compareMembers(player1, player2) {
  return player1['mapPosition'] - player2['mapPosition'];
}


