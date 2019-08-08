MAX_ROWS = 104;

function onEdit(event) {
  if (event.range.getSheet().getName() == 'WAR LOG') {
    //This is the Claims Column.
    if (event.range.getColumn() == 5) {
      SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CLAIMS').getRange(event.range.getRow(), 1).setValue(new Date());
    }
  }
}

function alert(message) {
  SpreadsheetApp.getUi().alert(message);
}

function refreshClanGamesPoints() {
  var clanGamesMembers = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CG').getRange('A5:C'+MAX_ROWS).getValues();
  var thisSeasonCGPoints = [];
  
  var maxRowNum = 0;
  for(var i=0; i<clanGamesMembers.length; i++) {
    if (!clanGamesMembers[i] || !clanGamesMembers[i][0] || clanGamesMembers[i][0]=='') continue;
    else {
      maxRowNum++;
      var headers = {"Authorization": "Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiIsImtpZCI6IjI4YTMxOGY3LTAwMDAtYTFlYi03ZmExLTJjNzQzM2M2Y2NhNSJ9.eyJpc3MiOiJzdXBlcmNlbGwiLCJhdWQiOiJzdXBlcmNlbGw6Z2FtZWFwaSIsImp0aSI6IjA4NmM0OWU0LTU4ZDMtNGIzZi04MWI5LThiYWJmNWMzYTMyZiIsImlhdCI6MTU1OTAyMzM3MCwic3ViIjoiZGV2ZWxvcGVyLzE2NmI1OTdlLWRhYzItNGU4ZS01NjM1LTA2OTA0M2VjNWU3ZSIsInNjb3BlcyI6WyJjbGFzaCJdLCJsaW1pdHMiOlt7InRpZXIiOiJkZXZlbG9wZXIvc2lsdmVyIiwidHlwZSI6InRocm90dGxpbmcifSx7ImNpZHJzIjpbIjEzMi4xNDUuMTQ3LjczIl0sInR5cGUiOiJjbGllbnQifV19.2KEWLiojgINVsXRAmHfY6hGCHNk0zF5ktVVcNKYuCmR2a9Jj8x7QUytV0l9OOixJJzRGEDYIfQcWi9g-ifG_FA"};
      var options = {
        'headers': headers,
        'muteHttpExceptions': true
      };
      Logger.log('Fetching CG Points for - ' + clanGamesMembers[i][0]);
      var response = UrlFetchApp.fetch('http://clashproxy.creativetechhub.com/v1/players/'+ encodeURIComponent(clanGamesMembers[i][1]), options);
      var responseJson = JSON.parse(response.getContentText());
      var achievements = responseJson['achievements'];
      for(var j=0; j<achievements.length; j++) {
        if (achievements[j].name == 'Games Champion') {
          var totalCGPoints = achievements[j].value;
          var netCGPoints = totalCGPoints - clanGamesMembers[i][2];
          if (netCGPoints > 4000) netCGPoints = 4000;
          Logger.log('CG Points - ' + netCGPoints);
          thisSeasonCGPoints.push([ [netCGPoints] ]);
        }
      }
    }
  }
  Logger.log('Total rows of data : ' + thisSeasonCGPoints.length);
  Logger.log('Updating cells D5-D' + (thisSeasonCGPoints.length+4));
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CG').
      getRange('D5:D' + (thisSeasonCGPoints.length+4)).setValues(thisSeasonCGPoints);
}

function refreshClanGamesMembers() {
  var activeMembers = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('WAR LOG').getRange('A5:B'+MAX_ROWS).getValues();
  var clanGamesMembers = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CG').getRange('A5:B'+MAX_ROWS).getValues();
  
  var nonMembersRow = 100;
  var movedRows = 0;
  // Remove stale member rows
  for(var i=0; i<50; i++) {
    var playerTag = clanGamesMembers[i][1];
    if (clanGamesMembers[i] && clanGamesMembers[i][1]) {
      if (findIndex(activeMembers, 1, playerTag) == -1) {
        var rowNum = 5 + i - movedRows;
        Logger.log('Removing - ' + clanGamesMembers[i][0]);
        var rowSpec = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CG').getRange('A' + rowNum + ':Z' + rowNum);
        SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CG').moveRows(rowSpec, nonMembersRow);
        movedRows++;
      }
    }
  }

  var clanGamesMembers = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CG').getRange('A5:B'+MAX_ROWS).getValues();
  
  var newRowNum = 0;
  for(var i=0; i<clanGamesMembers.length; i++) {
    if (clanGamesMembers[i] && clanGamesMembers[i][0] != '') continue;
    else {
      newRowNum = i+1+4;
      break;
    }
  }
  
  var newRows = [];
  for(var i=0; i<50; i++) {
    var playerTag = activeMembers[i][1];
    if (activeMembers[i] && activeMembers[i][1]) {
      if (findIndex(clanGamesMembers, 1, playerTag) == -1) {
        newRows.push([[activeMembers[i][0]], [activeMembers[i][1]]]);
      }
    }
  }
  if (newRows.length >0) {
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CG').
        getRange('A'+newRowNum + ':B' + (newRowNum+newRows.length-1)).setValues(newRows);
  } else {
    SpreadsheetApp.getUi().alert('No new Players to be added');
  }
  checkAndRefreshClanGamesPointsForSeason();
}

function checkAndRefreshClanGamesPointsForSeason() {
  var headers = {"Authorization": "Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiIsImtpZCI6IjI4YTMxOGY3LTAwMDAtYTFlYi03ZmExLTJjNzQzM2M2Y2NhNSJ9.eyJpc3MiOiJzdXBlcmNlbGwiLCJhdWQiOiJzdXBlcmNlbGw6Z2FtZWFwaSIsImp0aSI6IjA4NmM0OWU0LTU4ZDMtNGIzZi04MWI5LThiYWJmNWMzYTMyZiIsImlhdCI6MTU1OTAyMzM3MCwic3ViIjoiZGV2ZWxvcGVyLzE2NmI1OTdlLWRhYzItNGU4ZS01NjM1LTA2OTA0M2VjNWU3ZSIsInNjb3BlcyI6WyJjbGFzaCJdLCJsaW1pdHMiOlt7InRpZXIiOiJkZXZlbG9wZXIvc2lsdmVyIiwidHlwZSI6InRocm90dGxpbmcifSx7ImNpZHJzIjpbIjEzMi4xNDUuMTQ3LjczIl0sInR5cGUiOiJjbGllbnQifV19.2KEWLiojgINVsXRAmHfY6hGCHNk0zF5ktVVcNKYuCmR2a9Jj8x7QUytV0l9OOixJJzRGEDYIfQcWi9g-ifG_FA"};
  var options = {
    'headers': headers,
    'muteHttpExceptions': true
  };
  var clanGamesMembers = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CG').getRange('A5:D'+MAX_ROWS).getValues();
  var seasonStartValues = [];
  for(var i=0; i<50; i++) {
    if (clanGamesMembers[i][1] != '') {
      if (clanGamesMembers[i][3].length==0 || clanGamesMembers[i][3]==0 || clanGamesMembers[i][3]=='0') {
        var response = UrlFetchApp.fetch('http://clashproxy.creativetechhub.com/v1/players/'+ encodeURIComponent(clanGamesMembers[i][1]), options);
        var responseJson = JSON.parse(response.getContentText());
        var achievements = responseJson['achievements'];
        for(var j=0; j<achievements.length; j++) {
          if (achievements[j].name == 'Games Champion') {
            var totalCGPoints = achievements[j].value;
            Logger.log('CG Points - ' + totalCGPoints);
            seasonStartValues.push([ [totalCGPoints] ]);
          }
        }
      } else {
        seasonStartValues.push([ [clanGamesMembers[i][2]] ]);
      }
    }
  }
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CG').getRange('C5:C' + (seasonStartValues.length+4)).setValues(seasonStartValues);
}

function findIndex(searchArray, col, searchString) {
  for(var i=0; i<searchArray.length; i++) {
    if (searchArray && searchArray[i] && searchArray[i][col]==searchString) 
      return i;
  }
  return -1;
}

function updateTimestamp(range) {
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('CLAIMS').getRange(range).setValue(new Date());
}

function refreshLineUp() {
  var opponentClanTag = SpreadsheetApp.getActiveSheet().getRange('G2').getValue();
  var opponentClanName = SpreadsheetApp.getActiveSheet().getRange('G1').getValue();
  var warScore = SpreadsheetApp.getActiveSheet().getRange('G3').getValue();
  
  if (opponentClanTag != 'X' && warScore == 'X') {
    //This is regular War. Use Regular war API to refresh Lineup and scores.
    refreshLineUpRegularWar(true);
  }
}

function refreshLineUpRegularWar(fillNew) {
  var activeSheet = SpreadsheetApp.getActiveSheet();
  var progressCell = activeSheet.getRange('E4');
  
  var headers = {"Authorization": "Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiIsImtpZCI6IjI4YTMxOGY3LTAwMDAtYTFlYi03ZmExLTJjNzQzM2M2Y2NhNSJ9.eyJpc3MiOiJzdXBlcmNlbGwiLCJhdWQiOiJzdXBlcmNlbGw6Z2FtZWFwaSIsImp0aSI6IjA4NmM0OWU0LTU4ZDMtNGIzZi04MWI5LThiYWJmNWMzYTMyZiIsImlhdCI6MTU1OTAyMzM3MCwic3ViIjoiZGV2ZWxvcGVyLzE2NmI1OTdlLWRhYzItNGU4ZS01NjM1LTA2OTA0M2VjNWU3ZSIsInNjb3BlcyI6WyJjbGFzaCJdLCJsaW1pdHMiOlt7InRpZXIiOiJkZXZlbG9wZXIvc2lsdmVyIiwidHlwZSI6InRocm90dGxpbmcifSx7ImNpZHJzIjpbIjEzMi4xNDUuMTQ3LjczIl0sInR5cGUiOiJjbGllbnQifV19.2KEWLiojgINVsXRAmHfY6hGCHNk0zF5ktVVcNKYuCmR2a9Jj8x7QUytV0l9OOixJJzRGEDYIfQcWi9g-ifG_FA"};
  var options = {
    'headers': headers,
    'muteHttpExceptions': true
  };
  
  var opponentClanTag = activeSheet.getRange('G2').getValue();
  
  var response = UrlFetchApp.fetch('http://clashproxy.creativetechhub.com/v1/clans/'+ encodeURIComponent(opponentClanTag) + '/currentwar', options);
  if (response.getResponseCode() == 403) {
    SpreadsheetApp.getUi().alert("Looks like War Log is not public for clan - " + opponentClanTag)
    return;
  }
  var responseJson = JSON.parse(response.getContentText());

  var opponentClanName = responseJson['clan']['name'];
  if (activeSheet.getRange('G1').getValue() == 'X')
    activeSheet.getRange('G1').setValue(opponentClanName);
  var ourMembers = responseJson['opponent']['members'];
  if (addNew) {
    addNew(ourMembers);
  }
  ourMembers = ourMembers.sort(compareMembers);
  
  var warLog = activeSheet.getRange('B5:H'+MAX_ROWS).getValues();
  //var numRows = range.getNumRows();
  
  var warInProgress = (responseJson['state'] == 'inWar');
  
  var mapPositions = [];
  var attackLog = [];
  
  var idx = 0;
  while(warLog[idx] && warLog[idx][0] && warLog[idx][0]!='') {
    var playerTag = warLog[idx][0];
    Logger.log('Processing PlayerTag: ' + playerTag);
    //progressCell.setValue(progressCell.getValue()+".");
    var j=0;
    var playerInWar = false;
    for(;j<ourMembers.length; j++) {
      if (ourMembers[j]['tag'] == playerTag) {
        var member = ourMembers[j];
        mapPositions.push( [ [member['mapPosition']] ] );
        //range.getCell(i, 2).setValue( member['mapPosition'] );
        var attack1 = 'XXX';
        var attack2 = 'XXX';
        if (warInProgress) {
          //Check for Attacks
          if ('attacks' in member) {
            attack1 = member['attacks'][0]['stars'];
            if (member['attacks'].length > 1) {
              attack2 = member['attacks'][1]['stars'];
            }
          }
          attackLog.push([ [ warLog[idx][5] == 'XXX' ? attack1:warLog[idx][5] ], [ warLog[idx][6] == 'XXX' ? attack2:warLog[idx][6] ] ]);
        } else {
          attackLog.push([ ['XXX'],['XXX'] ]);
        }
        playerInWar = true;
        break;                       
      }
    }
    if (!playerInWar) {
      mapPositions.push( [ [''] ] );
      attackLog.push([ [ '-' ], [ '-' ] ]);
    }
    idx++;  
    ourMembers.splice(j, 1);    
  }

  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('WAR LOG').getRange('C5:C'+(idx+4)).setValues(mapPositions);
  SpreadsheetApp.getActiveSpreadsheet().getSheetByName('WAR LOG').getRange('G5:H'+(idx+4)).setValues(attackLog);
  activeSheet.getRange('A5:DG'+MAX_ROWS).sort(3);
  progressCell.setValue('');  
}

function addNew(members) {
  var activeSheet = SpreadsheetApp.getActiveSheet()
  var playerTags = activeSheet.getRange('B5:B'+MAX_ROWS).getValues();
  var playerNames = activeSheet.getRange('A5:A').getValues();
  var playerNamesAndTagsRange = activeSheet.getRange('A5:B'+MAX_ROWS);
  var emptyRowIdx = 0;
  while ( playerNames[emptyRowIdx++][0] != "" ) {
//    emptyRowIdx++;
  }

  for(var j=0;j<members.length; j++) {
    var member = members[j];
    var searchResult = searchArray(playerTags, member['tag']);

    //if (emptyRowIdx >= 50) return;
    if (searchResult == -1) {
      playerNamesAndTagsRange.getCell(emptyRowIdx, 1).setValue(member['name']);
      playerNamesAndTagsRange.getCell(emptyRowIdx, 2).setValue(member['tag']);
      emptyRowIdx++;
    }
  }
}

function searchArray(array, searchString) {
  var found = false;
  var i = 0
  for(; i<array.length; i++) {
    if (array[i] == searchString) {
      found = true;
      break;
    }
  }
  
  if (found) return i;
  else return -1;
}

function refreshLineUpCWLWar() {
  var activeSheet = SpreadsheetApp.getActiveSheet();
  var progressCell = activeSheet.getRange('D4');
  
  var headers = {"Authprivation": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzUxMiIsImtpZCI6IjI4YTMxOGY3LTAwMDAtYTFlYi03ZmExLTJjNzQzM2M2Y2NhNSJ9.eyJpc3MiOiJzdXBlcmNlbGwiLCJhdWQiOiJzdXBlcmNlbGw6Z2FtZWFwaSIsImp0aSI6IjA4NmM0OWU0LTU4ZDMtNGIzZi04MWI5LThiYWJmNWMzYTMyZiIsImlhdCI6MTU1OTAyMzM3MCwic3ViIjoiZGV2ZWxvcGVyLzE2NmI1OTdlLWRhYzItNGU4ZS01NjM1LTA2OTA0M2VjNWU3ZSIsInNjb3BlcyI6WyJjbGFzaCJdLCJsaW1pdHMiOlt7InRpZXIiOiJkZXZlbG9wZXIvc2lsdmVyIiwidHlwZSI6InRocm90dGxpbmcifSx7ImNpZHJzIjpbIjEzMi4xNDUuMTQ3LjczIl0sInR5cGUiOiJjbGllbnQifV19.2KEWLiojgINVsXRAmHfY6hGCHNk0zF5ktVVcNKYuCmR2a9Jj8x7QUytV0l9OOixJJzRGEDYIfQcWi9g-ifG_FA"};
  var options = {
    'headers': headers
  };
  
  var response = UrlFetchApp.fetch('http://clashproxy.creativetechhub.com/v1/clanwarleagues/wars/%232Y2VP2P2G', options);
  var responseJson = JSON.parse(response.getContentText());
  var clan = responseJson['clan'];
  var members = clan['members'];
  members = members.sort(compareMembers);
  var range = activeSheet.getRange('B5:C'+MAX_ROWS);
  var numRows = range.getNumRows();
  
  for(var i=1; i<=numRows; i++) {
    var playerTag = range.getCell(i, 1).getValue();
    progressCell.setValue(progressCell.getValue()+".");
    var j=0;
    for(;j<members.length; j++) {
      if (members[j]['tag'] == playerTag) {
        range.getCell(i, 2).setValue( members[j]['mapPosition'] );
        break;                       
      }
    }
    members.splice(j, 1);
  }

  activeSheet.getRange('A5:DE'+MAX_ROWS).sort(3);
  progressCell.setValue('');
}

function lineUp() {
}

function compareMembers(player1, player2) {
  return player1['mapPosition'] - player2['mapPosition'];
}