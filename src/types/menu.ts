// Shape of src/data/menu.json. Every item has price XOR variants — validated
// across all 153 items when the data was received, zero exceptions.
export interface MenuVariant {
  name: string;
  price: number;
  veg: boolean;
  nameHi: string;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  price?: number;
  veg?: boolean;
  variants?: MenuVariant[];
  prepTimeMinutes: number;
  photo: string;
  nameHi: string;
  /**
   * Sold at the counter, not cooked — water bottles today. Two consequences,
   * and they must travel together:
   *   1. never shown on the kitchen board (nothing to make), and
   *   2. never counted in prep time. Prep is a MEAN across lines, so a
   *      0-minute bottle would drag a 25-minute biryani order down to 13 and
   *      the kitchen countdown with it.
   */
  counterItem?: boolean;
}

export interface MenuCategory {
  id: string;
  name: string;
  note?: string;
  items: MenuItem[];
}

export interface Menu {
  restaurant: string;
  location: string;
  tableCount: number;
  categories: MenuCategory[];
}
