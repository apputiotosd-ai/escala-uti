// Chave publicavel: e feita para ficar exposta no navegador.
// Quem protege os dados sao as regras de acesso do banco, não esta chave.
export const SUPABASE_URL = "https://meyoapxqnbeyrnvhmwtu.supabase.co";
export const SUPABASE_KEY = "sb_publishable_uhJ4OHDy2VULCJTFtWFLDw_-6rISPEX";

// Chave publica VAPID: identifica este app para o servico de push do
// navegador. E publica por definicao, a privada fica so no servidor.
export const VAPID_PUBLIC_KEY =
  "BGf3Zt-hbVQS-mcOnmqtc3k7aXMRTCM_7Krmg2NU5ePlOH9s4rE3z52DtUJOumbPyURhfWnkPUP79GXKO-QJ2HQ";

export const SHIFTS = ["M", "T", "SN"];

export const SHIFT_INFO = {
  M:  { label: "Manha", hours: "07h as 13h", start: 7,  end: 13 },
  T:  { label: "Tarde", hours: "13h as 19h", start: 13, end: 19 },
  SN: { label: "Noite", hours: "19h as 07h", start: 19, end: 31 },
};
