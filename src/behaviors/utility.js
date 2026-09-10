const TRASH_ITEMS = new Set([
  'rotten_flesh', 'poisonous_potato', 'spider_eye', 'fermented_spider_eye',
  'gravel', 'flint', 'feather', 'bone', 'string', 'stick',
  'cobblestone', 'dirt', 'andesite', 'diorite', 'granite', 'sand',
  'wheat_seeds', 'pumpkin_seeds', 'melon_seeds', 'beetroot_seeds',
  'oak_sapling', 'spruce_sapling', 'birch_sapling', 'jungle_sapling', 'acacia_sapling', 'dark_oak_sapling',
  'dead_bush', 'vine', 'tall_grass', 'fern',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
  'oxeye_daisy', 'cornflower', 'lily_of_the_valley',
  'brown_mushroom', 'red_mushroom',
  'sugar_cane', 'egg', 'sugar', 'wheat', 'clay_ball', 'brick',
  'glass_bottle', 'snowball', 'bowl', 'rabbit_hide',
  'pufferfish', 'tropical_fish', 'ink_sac'
]);
const COOKABLE_RAW = new Set(['raw_beef', 'raw_chicken', 'raw_porkchop', 'raw_mutton', 'raw_rabbit', 'raw_cod', 'raw_salmon']);

const ARMOR_TIERS = {
  netherite_helmet: 0, diamond_helmet: 1, iron_helmet: 2, golden_helmet: 3, chainmail_helmet: 4, leather_helmet: 5, turtle_helmet: 2,
  netherite_chestplate: 0, diamond_chestplate: 1, iron_chestplate: 2, golden_chestplate: 3, chainmail_chestplate: 4, leather_chestplate: 5,
  netherite_leggings: 0, diamond_leggings: 1, iron_leggings: 2, golden_leggings: 3, chainmail_leggings: 4, leather_leggings: 5,
  netherite_boots: 0, diamond_boots: 1, iron_boots: 2, golden_boots: 3, chainmail_boots: 4, leather_boots: 5
};

const SLOT_TYPES = ['helmet', 'chestplate', 'leggings', 'boots'];
const EQUIP_DEST = { helmet: 'head', chestplate: 'torso', leggings: 'legs', boots: 'feet' };

class UtilityBehavior {
  constructor(bot, systems) {
    this.bot = bot;
    this.systems = systems;
    this._owner = (systems.settings && systems.settings.owner) || null;
    if (!this._owner) console.warn('[Utility] owner not configured in settings');
    this._lastTrashCheck = 0;
    this._trashThrottle = 600;
    this._lastArmorCheck = 0;
    this._armorThrottle = 1000;
    this._collectPending = false;

    this.bot.on('playerCollect', (collector, collected) => {
      if (collector !== this.bot.entity) return;
      if (this._collectPending) return;
      this._collectPending = true;
      setTimeout(() => { this._collectPending = false; this._equipBestArmor(); this._disposeTrash(); }, 600);
    });

    this._currentEquipment = {};
  }

  _getArmorTier(itemName) {
    return ARMOR_TIERS[itemName] !== undefined ? ARMOR_TIERS[itemName] : 99;
  }

  _getSlotType(itemName) {
    for (const slot of SLOT_TYPES) {
      if (itemName.includes(slot)) return slot;
    }
    return null;
  }

  _getEquippedTier(slot) {
    const dest = EQUIP_DEST[slot];
    if (!this.bot.inventory || !this.bot.inventory.slots) return 99;
    const idx = dest === 'head' ? 5 : dest === 'torso' ? 6 : dest === 'legs' ? 7 : 8;
    const equipped = this.bot.inventory.slots[idx];
    return equipped ? this._getArmorTier(equipped.name) : 99;
  }

  _equipBestArmor() {
    const now = Date.now();
    if (now - this._lastArmorCheck < this._armorThrottle) return;
    this._lastArmorCheck = now;

    for (const slot of SLOT_TYPES) {
      const items = this.bot.inventory.items()
        .filter(i => this._getSlotType(i.name) === slot)
        .sort((a, b) => this._getArmorTier(a.name) - this._getArmorTier(b.name));

      if (items.length === 0) continue;

      const best = items[0];
      const bestTier = this._getArmorTier(best.name);
      const equippedTier = this._getEquippedTier(slot);

      if (bestTier < equippedTier) {
        this.bot.equip(best, EQUIP_DEST[slot]).catch((e) => console.warn('[Utility] equip failed:', e.message));
      }
    }
  }

  async _disposeTrash() {
    const now = Date.now();
    if (now - this._lastTrashCheck < this._trashThrottle) return;
    this._lastTrashCheck = now;

    for (const item of this.bot.inventory.items()) {
      if (COOKABLE_RAW.has(item.name)) continue;
      if (TRASH_ITEMS.has(item.name)) {
        try {
          await this.bot.tossStack(item);
        } catch (err) {
          if (err && !String(err.message || '').includes('Not enough')) {
            console.error('[Utility] toss error:', err.message);
          }
        }
      }
    }
  }

  tickFast() {
    this._eyeContact();
  }

  _eyeContact() {
    if (!this._owner) return;
    const owner = this.bot.players[this._owner];
    if (!owner || !owner.entity || !this.bot.entity) return;

    const dist = this.bot.entity.position.distanceTo(owner.entity.position);
    if (dist > 6) return;

    if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) return;

    if (this.systems.combat && this.systems.combat.isFighting()) return;

    const facePos = owner.entity.position.offset(0, 1.6, 0);
    this.bot.lookAt(facePos).catch(() => {});
  }

  stop() {}
}

module.exports = { UtilityBehavior };
