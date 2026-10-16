export type ComboItemResponse = {
  product_id: number;
  name: string | null;
  image_url: string | null;
  quantity: number;
};

export type ComboResponse = {
  id: number;
  name: string;
  description: string | null;
  combo_price: string;
  original_price: string | null;
  items: ComboItemResponse[];
};

export type ComboLineInput = {
  combo_id: number;
  quantity: string;
};
