import i18n from "i18next";
import { initReactI18next } from "react-i18next";

i18n.use(initReactI18next).init({
  lng: localStorage.getItem("nhp_language") || "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  resources: {
    en: { translation: { dashboard: "Dashboard", transactions: "Transactions", security: "Security", profile: "Profile", signOut: "Sign out", balance: "Wallet balance" } },
    ne: { translation: { dashboard: "ड्यासबोर्ड", transactions: "कारोबारहरू", security: "सुरक्षा", profile: "प्रोफाइल", signOut: "साइन आउट", balance: "वालेट मौज्दात" } },
  },
});
export default i18n;
