export type SavedSweetRecordField = {
  id: string;
  title: string;
  value: string | string[];
};

export type SavedSweetRecordStep = {
  id: string;
  title: string;
  label: string;
  fields: SavedSweetRecordField[];
};
