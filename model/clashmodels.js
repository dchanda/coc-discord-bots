const Sequelize = require('sequelize');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: '/u01/data/almostdivorced/players.db',
    logging: false
});

class PlayerData extends Sequelize.Model {}
PlayerData.init({
  // attributes
  tag: {
    type: Sequelize.STRING,
    allowNull: false,
    primaryKey: true
  },
  name: {
    type: Sequelize.STRING,
    allowNull: false
  },
  joinDate: {type: Sequelize.DATE, allowNull: false},
  townhallLevel: {type: Sequelize.INTEGER, allowNull: false},
  donations: {type: Sequelize.INTEGER},
  donationsReceived: {type: Sequelize.INTEGER},
  goldGrab: {type: Sequelize.INTEGER},
  elixirEscapade: {type: Sequelize.INTEGER},
  heroicHeist: {type: Sequelize.INTEGER},
  trophies: {type: Sequelize.INTEGER},
  inClan: {type: Sequelize.BOOLEAN, defaultValue: true},
  leaveDate: {type: Sequelize.DATE, allowNull: false}
}, {
  sequelize,
  modelName: 'player_data',
  createdAt: false,
  updatedAt: false,  
});

class Troops extends Sequelize.Model {}
Troops.init({
  // attributes
  playerTag: {
    type: Sequelize.STRING,
    allowNull: false,
    primaryKey: true,
  },
  barbarian: {type: Sequelize.INTEGER, defaultValue: 0},
  archer: {type: Sequelize.INTEGER, defaultValue: 0},
  giant: {type: Sequelize.INTEGER, defaultValue: 0},
  goblin: {type: Sequelize.INTEGER, defaultValue: 0},
  wallbreaker: {type: Sequelize.INTEGER, defaultValue: 0},
  balloon: {type: Sequelize.INTEGER, defaultValue: 0},
  wizard: {type: Sequelize.INTEGER, defaultValue: 0},
  healer: {type: Sequelize.INTEGER, defaultValue: 0},
  dragon: {type: Sequelize.INTEGER, defaultValue: 0},
  pekka: {type: Sequelize.INTEGER, defaultValue: 0},
  babydragon: {type: Sequelize.INTEGER, defaultValue: 0},
  miner: {type: Sequelize.INTEGER, defaultValue: 0},
  electrodragon: {type: Sequelize.INTEGER, defaultValue: 0},
  minion: {type: Sequelize.INTEGER, defaultValue: 0},
  hogrider: {type: Sequelize.INTEGER, defaultValue: 0},
  valkyrie: {type: Sequelize.INTEGER, defaultValue: 0},
  golem: {type: Sequelize.INTEGER, defaultValue: 0},
  witch: {type: Sequelize.INTEGER, defaultValue: 0},
  lavahound: {type: Sequelize.INTEGER, defaultValue: 0},
  bowler: {type: Sequelize.INTEGER, defaultValue: 0},
  icegolem: {type: Sequelize.INTEGER, defaultValue: 0},
  barbarianKing: {type: Sequelize.INTEGER, defaultValue: 0},
  archerQueen: {type: Sequelize.INTEGER, defaultValue: 0},
  grandWarden: {type: Sequelize.INTEGER, defaultValue: 0},
}, {
  sequelize,
  modelName: 'troops',
  createdAt: false,
  updatedAt: false,  
});

class Spells extends Sequelize.Model {}
Spells.init({
  // attributes
  playerTag: {
    type: Sequelize.STRING,
    allowNull: false,
    primaryKey: true,
  },
  lightning: {type: Sequelize.INTEGER, defaultValue: 0},
  heal: {type: Sequelize.INTEGER, defaultValue: 0},
  rage: {type: Sequelize.INTEGER, defaultValue: 0},
  jump: {type: Sequelize.INTEGER, defaultValue: 0},
  freeze: {type: Sequelize.INTEGER, defaultValue: 0},
  clone: {type: Sequelize.INTEGER, defaultValue: 0},
  poison: {type: Sequelize.INTEGER, defaultValue: 0},
  earthquake: {type: Sequelize.INTEGER, defaultValue: 0},
  haste: {type: Sequelize.INTEGER, defaultValue: 0},
  skeleton: {type: Sequelize.INTEGER, defaultValue: 0},
  bat: {type: Sequelize.INTEGER, defaultValue: 0},
}, {
  sequelize,
  modelName: 'spells',
  createdAt: false,
  updatedAt: false,  
});

Spells.belongsTo(PlayerData, {foreignKey: 'playerTag', targetKey: 'tag'});
PlayerData.hasOne(Spells, {as: 'Spells', foreignKey: 'playerTag'});
Troops.belongsTo(PlayerData, {foreignKey: 'playerTag', targetKey: 'tag'});
PlayerData.hasOne(Troops, {as: 'Troops', foreignKey: 'playerTag'});

class TroopMaximums extends Sequelize.Model {}
TroopMaximums.init({
  // attributes
  townhallLevel: {
    type: Sequelize.STRING,
    allowNull: false,
    primaryKey: true
  },
  barbarian: {type: Sequelize.INTEGER},
  archer: {type: Sequelize.INTEGER},
  giant: {type: Sequelize.INTEGER},
  goblin: {type: Sequelize.INTEGER},
  wallbreaker: {type: Sequelize.INTEGER},
  balloon: {type: Sequelize.INTEGER},
  wizard: {type: Sequelize.INTEGER},
  healer: {type: Sequelize.INTEGER},
  dragon: {type: Sequelize.INTEGER},
  pekka: {type: Sequelize.INTEGER},
  babydragon: {type: Sequelize.INTEGER},
  miner: {type: Sequelize.INTEGER},
  electrodragon: {type: Sequelize.INTEGER},
  minion: {type: Sequelize.INTEGER},
  hogrider: {type: Sequelize.INTEGER},
  valkyrie: {type: Sequelize.INTEGER},
  golem: {type: Sequelize.INTEGER},
  witch: {type: Sequelize.INTEGER},
  lavahound: {type: Sequelize.INTEGER},
  bowler: {type: Sequelize.INTEGER},
  icegolem: {type: Sequelize.INTEGER},
  barbarianKing: {type: Sequelize.INTEGER},
  archerQueen: {type: Sequelize.INTEGER},
  grandWarden: {type: Sequelize.INTEGER},
}, {
  sequelize,
  modelName: 'troop_th_max',
  tableName: 'troop_th_max',
  createdAt: false,
  updatedAt: false,  
});

class SpellMaximums extends Sequelize.Model {}
SpellMaximums.init({
  // attributes
  townhallLevel: {
    type: Sequelize.STRING,
    allowNull: false,
    primaryKey: true
  },
  lightning: {type: Sequelize.INTEGER},
  heal: {type: Sequelize.INTEGER},
  rage: {type: Sequelize.INTEGER},
  jump: {type: Sequelize.INTEGER},
  freeze: {type: Sequelize.INTEGER},
  clone: {type: Sequelize.INTEGER},
  poison: {type: Sequelize.INTEGER},
  earthquake: {type: Sequelize.INTEGER},
  haste: {type: Sequelize.INTEGER},
  skeleton: {type: Sequelize.INTEGER},
  bat: {type: Sequelize.INTEGER},
}, {
  sequelize,
  modelName: 'spell_th_max',
  tableName: 'spell_th_max',
  createdAt: false,
  updatedAt: false,  
});

module.exports = { PlayerData, Troops, Spells, TroopMaximums, SpellMaximums, sequelize }
