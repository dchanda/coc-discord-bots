const fs = require('fs');
const readline = require('readline');
const {google} = require('googleapis');
var Discord = require('discord.io');
var moment = require('moment-timezone');
var logger = require('winston');
var RestClientLib = require('node-rest-client').Client;
var googleCredentials = require('./googleapi-credentials.json');

logger.remove(logger.transports.Console);
logger.add(new logger.transports.Console, {
    colorize: true
});
logger.level = 'debug';

var REQUESTS = 0;

/* Constants Declaration */
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets', ];
const TOKEN_PATH = 'googleapi-token.json';
const SPREADSHEET_ID = '1kEDgi1r2D32Z1G9wRCx8KL89Rt6c5aAh8rvD_nLkNDQ';
const clanTag = '#22V9VC28V';
const CGSHEET = 'CG';


var restClient = new RestClientLib();

const CLASH_HEADER = {'Authorization': 'Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiIsImtpZCI6IjI4YTMxOGY3LTAwMDAtYTFlYi03ZmExLTJjNzQzM2M2Y2NhNSJ9.eyJpc3MiOiJzdXBlcmNlbGwiLCJhdWQiOiJzdXBlcmNlbGw6Z2FtZWFwaSIsImp0aSI6IjQ2NThlNTJkLTJiZWQtNDkxNS1iN2M4LTI1MDVhOTY3YWY0YSIsImlhdCI6MTU1ODExODYxMiwic3ViIjoiZGV2ZWxvcGVyLzE2NmI1OTdlLWRhYzItNGU4ZS01NjM1LTA2OTA0M2VjNWU3ZSIsInNjb3BlcyI6WyJjbGFzaCJdLCJsaW1pdHMiOlt7InRpZXIiOiJkZXZlbG9wZXIvc2lsdmVyIiwidHlwZSI6InRocm90dGxpbmcifSx7ImNpZHJzIjpbIjEzMi4xNDUuMTUwLjE2MyJdLCJ0eXBlIjoiY2xpZW50In1dfQ._j7NRBpxbSsgKp8T35R-7ZvEd6Fgk7q5Jj-o4tc1K-5Tk2soLRtDsF9QKghtGKLYe_3ruUc1S5MPeqz9YVBY8w'};

authorize(googleCredentials, populateClanGamesData);

setTimeout(function() {
  console.log('hello world!');
}, 1000000);

function populateClanGamesData(auth) {
    const sheets = google.sheets({version: 'v4', auth});
    sheets.spreadsheets.values.batchGet({
        spreadsheetId: SPREADSHEET_ID,
        ranges: [CGSHEET+'!B5:B54', CGSHEET+'!C5:C54']
    }, (err, res) => { 
        if (err) {
            logger.warn('The Google API returned an error: ' + err);
            return;
        }
        var playerTags = res.data.valueRanges[0].values;
        console.log('Retrieved ' + playerTags.length + ' rows!');
        var playerCGPoints = {};
        if(!playerTags.length) 
            return;
        for(var i=0; i<playerTags.length; i++) {
            if (!playerTags[i] || !playerTags[i][0]) continue;
            playerTag = playerTags[i][0];
            console.log('Processing playerTag - ' + playerTags[i][0] );

            var args = {
                path: {'playerTag': encodeURIComponent(playerTag)},
                headers: CLASH_HEADER
            };
            restClient.get('http://clashproxy.creativetechhub.com/v1/players/${playerTag}', args, 
                    processData.bind({cellNumber: i, auth: auth}));
        }
    });
}

function processData(data, response) {
    const cellNumber = this.cellNumber;
    const auth = this.auth;
    const sheets = google.sheets({version: 'v4', auth});

    if (response.statusCode != 200) {
        console.log("CoC Returned a response code : " + response.statusCode);
        return;
    }
    achievements = data.achievements;
    var cgPoints = 0;
    for(var j=0; j<achievements.length; j++) {
        if (achievements[j].name == 'Games Champion') {
            cgPoints = achievements[j].value;
            sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: CGSHEET+'!C'+(5+cellNumber),
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[cgPoints]]
                }
            }, (err, result) => {
                if (err) {
                    logger.warn('Error while updating CG Points ' + err);
                    return;
                }
                console.log('Update CG Points for ' + cellNumber);
            });
        }
    }
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