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
