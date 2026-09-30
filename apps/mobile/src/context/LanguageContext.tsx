import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

type Language = "en" | "ne";

const messages = {
  en: {
    palmPay: "Palm Pay",
    qrPay: "QR Pay",
    scanQr: "Scan QR",
    generateQr: "Generate QR",
    amount: "Amount",
    merchant: "Merchant",
    confirmPayment: "Confirm Payment",
    paymentSuccessful: "Payment Successful",
    paymentFailed: "Payment Failed",
    qrExpired: "QR Expired",
    invalidQr: "Invalid QR",
    sendMoney: "Send Money",
  },
  ne: {
    palmPay: "हातबाट भुक्तानी",
    qrPay: "QR भुक्तानी",
    scanQr: "QR स्क्यान गर्नुहोस्",
    generateQr: "QR बनाउनुहोस्",
    amount: "रकम",
    merchant: "व्यापारी",
    confirmPayment: "भुक्तानी पुष्टि गर्नुहोस्",
    paymentSuccessful: "भुक्तानी सफल भयो",
    paymentFailed: "भुक्तानी असफल भयो",
    qrExpired: "QR को समय समाप्त भयो",
    invalidQr: "अमान्य QR",
    sendMoney: "पैसा पठाउनुहोस्",
  },
} as const;

type MessageKey = keyof (typeof messages)["en"];
interface LanguageContextValue {
  language: Language;
  setLanguage(value: Language): Promise<void>;
  t(key: MessageKey): string;
}

const STORAGE_KEY = "nhp.mobile.language";
const LanguageContext = createContext<LanguageContextValue | null>(null);

async function readLanguage(): Promise<Language> {
  const value =
    Platform.OS === "web"
      ? globalThis.localStorage?.getItem(STORAGE_KEY)
      : await SecureStore.getItemAsync(STORAGE_KEY);
  return value === "ne" ? "ne" : "en";
}

async function writeLanguage(value: Language): Promise<void> {
  if (Platform.OS === "web") globalThis.localStorage?.setItem(STORAGE_KEY, value);
  else await SecureStore.setItemAsync(STORAGE_KEY, value);
}

export function LanguageProvider({ children }: PropsWithChildren) {
  const [language, updateLanguage] = useState<Language>("en");
  useEffect(() => {
    void readLanguage().then(updateLanguage);
  }, []);
  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      async setLanguage(next) {
        updateLanguage(next);
        await writeLanguage(next);
      },
      t: (key) => messages[language][key],
    }),
    [language],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used inside LanguageProvider");
  return context;
}
