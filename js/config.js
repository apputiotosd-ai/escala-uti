// Chave publicavel: e feita para ficar exposta no navegador.
// Quem protege os dados sao as regras de acesso do banco, nao esta chave.
export const SUPABASE_URL = "https://meyoapxqnbeyrnvhmwtu.supabase.co";
export const SUPABASE_KEY = "sb_publishable_uhJ4OHDy2VULCJTFtWFLDw_-6rISPEX";

export const SHIFTS = ["M", "T", "SN"];

export const SHIFT_INFO = {
  M:  { label: "Manha", hours: "07h as 13h", start: 7,  end: 13 },
  T:  { label: "Tarde", hours: "13h as 19h", start: 13, end: 19 },
  SN: { label: "Noite", hours: "19h as 07h", start: 19, end: 31 },
};
