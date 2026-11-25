import { useEffect, useState } from 'react'

export type HelpLang = 'en' | 'ur'

export type HelpTranslations = {
  dir: 'ltr' | 'rtl'
  cardTitle: string
  cardSubtitle: string
  whatsappSupport: string
  callUs: string
  helpGuide: string
  supportHoursLabel: string
  versionPrefix: string
  licensePrefix: string
  untilWord: string
  helpButton: string
  closeLabel: string
  // Help Center Page
  pageTitle: string
  pageSubtitle: string
  languageLabel: string
  backToPos: string
  shortcutsTitle: string
  shortcutsSubtitle: string
  shortcutColKey: string
  shortcutColAction: string
  shortcuts: ReadonlyArray<{ keys: string; action: string }>
  quickFixesTitle: string
  quickFixesSubtitle: string
  quickFixes: ReadonlyArray<{ title: string; answer: string }>
  goodHabitsTitle: string
  goodHabitsSubtitle: string
  goodHabits: ReadonlyArray<string>
  supportInfoTitle: string
  supportInfoSubtitle: string
  copySupportInfo: string
  copiedConfirmation: string
  fieldAppVersion: string
  fieldLicenseId: string
  fieldDeviceId: string
  fieldDbSize: string
  fieldOs: string
  reportTitle: string
  reportSubtitle: string
  reportDescLabel: string
  reportDescPlaceholder: string
  reportScreenshotLabel: string
  reportScreenshotHint: string
  reportSubmitBtn: string
  reportOfflineNote: string
  reportRequiredError: string
  offlineBadge: string
}

export const helpDictionary: Record<HelpLang, HelpTranslations> = {
  en: {
    dir: 'ltr',
    cardTitle: 'Need Help?',
    cardSubtitle: 'Our team is here to help you keep your shop running smoothly.',
    whatsappSupport: 'WhatsApp Support',
    callUs: 'Call Us',
    helpGuide: 'Help Guide',
    supportHoursLabel: 'Support Hours',
    versionPrefix: 'Version',
    licensePrefix: 'License:',
    untilWord: 'until',
    helpButton: 'Help',
    closeLabel: 'Close',
    pageTitle: 'Help Center',
    pageSubtitle: 'Offline POS guide, keyboard shortcuts, quick fixes, and direct technical support',
    languageLabel: 'Language',
    backToPos: 'Open POS',
    shortcutsTitle: 'Keyboard Shortcuts',
    shortcutsSubtitle: 'Active shortcuts built into the POS application',
    shortcutColKey: 'Shortcut',
    shortcutColAction: 'Action',
    shortcuts: [
      { keys: 'F2', action: 'Focus barcode scanner & product search on POS' },
      { keys: 'F5', action: 'Review & generate bill preview on POS' },
      { keys: 'Enter', action: 'Add matching barcode / unique search product on POS' },
      { keys: 'Esc', action: 'Close active popup dialog, dropdown, or modal window' },
      { keys: 'Ctrl + / - / 0', action: 'Zoom desktop interface in, out, or reset to 100%' },
    ],
    quickFixesTitle: 'Quick Fixes',
    quickFixesSubtitle: 'Fast solutions for everyday shop issues',
    quickFixes: [
      {
        title: 'Printer not working',
        answer: 'Check printer power and USB cable, verify your default thermal/A4 printer in Windows Settings, or use the PDF export option as a backup.',
      },
      {
        title: 'Barcode not scanning',
        answer: 'Press F2 to focus the search box before scanning, verify the USB scanner acts as a keyboard (HID), or use the Scan button for camera scanning.',
      },
      {
        title: 'Cannot create a bill',
        answer: 'Open a cash shift first. Click "Open Shift" at the top of the POS sale panel or go to Cash & Shifts → Open New Shift.',
      },
      {
        title: 'Power went off mid-day',
        answer: 'Already completed bills are safely stored in your local database. Re-open the app and check Sales History to verify whether the last bill saved.',
      },
      {
        title: 'Item shows "Out of stock"',
        answer: 'Check the product quantity in Inventory or Products. Receive a new purchase in Purchases or record a stock count adjustment in Inventory.',
      },
    ],
    goodHabitsTitle: 'Good Shop Habits',
    goodHabitsSubtitle: 'Best practices to keep cash, stock, and records accurate',
    goodHabits: [
      'Always count physical drawer cash carefully before closing your shift.',
      'Take a weekly backup (or daily copy onto a separate USB drive) from Settings → Backup & Restore.',
      'Do not change the PC date or time manually — bill numbers, daily reports, and license checks rely on accurate time.',
      'Hand the printed receipt to the customer only after clicking "Complete Bill" and seeing the confirmation notice.',
    ],
    supportInfoTitle: 'Technical Support Info',
    supportInfoSubtitle: 'Safe system details only (no sales, customer, or password data included)',
    copySupportInfo: 'Copy Support Info',
    copiedConfirmation: 'Copied',
    fieldAppVersion: 'App Version',
    fieldLicenseId: 'License ID',
    fieldDeviceId: 'Device ID',
    fieldDbSize: 'Database Size',
    fieldOs: 'Operating System',
    reportTitle: 'Report a Problem',
    reportSubtitle: 'Describe the issue and send it directly to Vertexia Support on WhatsApp',
    reportDescLabel: 'What went wrong?',
    reportDescPlaceholder: 'Example: Receipt did not print after clicking Complete Bill...',
    reportScreenshotLabel: 'Optional Screenshot (attach in WhatsApp chat)',
    reportScreenshotHint: 'No cloud ticket server is connected yet — clicking Send opens WhatsApp with your issue and POS details pre-filled; attach your selected screenshot directly in WhatsApp.',
    reportSubmitBtn: 'Send via WhatsApp',
    reportOfflineNote: 'This Help Center works 100% offline. Internet is only needed when opening WhatsApp.',
    reportRequiredError: 'Please describe the problem before sending.',
    offlineBadge: 'Available Offline',
  },
  ur: {
    dir: 'rtl',
    cardTitle: 'مدد درکار ہے؟',
    cardSubtitle: 'ہماری ٹیم آپ کی دکان کو بغیر رکاوٹ چلانے میں مدد کے لیے موجود ہے۔',
    whatsappSupport: 'واٹس ایپ سپورٹ',
    callUs: 'کال کریں',
    helpGuide: 'ہیلپ گائیڈ',
    supportHoursLabel: 'سپورٹ کے اوقات',
    versionPrefix: 'ورژن',
    licensePrefix: 'لائسنس:',
    untilWord: 'تک',
    helpButton: 'مدد',
    closeLabel: 'بند کریں',
    pageTitle: 'ہیلپ سینٹر',
    pageSubtitle: 'آف لائن POS گائیڈ، کی بورڈ شارٹ کٹس، فوری حل اور ٹیکنیکل سپورٹ',
    languageLabel: 'زبان',
    backToPos: 'POS کھولیں',
    shortcutsTitle: 'کی بورڈ شارٹ کٹس',
    shortcutsSubtitle: 'POS سسٹم میں موجود فعال شارٹ کٹس',
    shortcutColKey: 'شارٹ کٹ',
    shortcutColAction: 'کام',
    shortcuts: [
      { keys: 'F2', action: 'POS پر بارکوڈ اسکینر اور پروڈکٹ سرچ پر فوکس کریں' },
      { keys: 'F5', action: 'بل کا پری ویو دیکھیں اور بل مکمل کرنے کے لیے کھولیں' },
      { keys: 'Enter', action: 'بارکوڈ یا سرچ سے میچ ہونے والا پروڈکٹ کارٹ میں شامل کریں' },
      { keys: 'Esc', action: 'کھلا ہوا پاپ اپ، ڈراپ ڈاؤن یا ونڈو بند کریں' },
      { keys: 'Ctrl + / - / 0', action: 'ڈیسک ٹاپ اسکرین کو زوم ان، زوم آؤٹ یا 100% پر ری سیٹ کریں' },
    ],
    quickFixesTitle: 'فوری حل',
    quickFixesSubtitle: 'روزمرہ مسائل کے آسان اور تیز حل',
    quickFixes: [
      {
        title: 'پرنٹر کام نہیں کر رہا',
        answer: 'پرنٹر کی پاور اور USB کیبل چیک کریں، ونڈوز سیٹنگز میں ڈیفالٹ پرنٹر دیکھیں، یا متبادل کے طور پر PDF ڈاؤن لوڈ استعمال کریں۔',
      },
      {
        title: 'بارکوڈ اسکین نہیں ہو رہا',
        answer: 'اسکین کرنے سے پہلے F2 دبائیں تاکہ سرچ باکس فوکس ہو جائے، اسکینر کی USB کیبل چیک کریں یا Scan بٹن استعمال کریں۔',
      },
      {
        title: 'بل نہیں بن رہا',
        answer: 'پہلے کیش شفٹ کھولیں۔ POS سیل پینل میں "Open Shift" یا Cash & Shifts → Open New Shift پر کلک کریں۔',
      },
      {
        title: 'بجلی چلی گئی',
        answer: 'مکمل کیے گئے بل مقامی ڈیٹا بیس میں محفوظ رہتے ہیں۔ ایپ دوبارہ کھول کر Sales History میں آخری بل چیک کریں۔',
      },
      {
        title: 'آئٹم "Out of stock" دکھا رہا ہے',
        answer: 'Inventory یا Products میں اسٹاک چیک کریں۔ Purchases میں نئی خریداری درج کریں یا Inventory میں اسٹاک ایڈجسٹ کریں۔',
      },
    ],
    goodHabitsTitle: 'دکان کے اچھے اصول',
    goodHabitsSubtitle: 'کیش، اسٹاک اور حساب کتاب کو درست رکھنے کی عادات',
    goodHabits: [
      'شفٹ بند کرنے سے پہلے دراز میں موجود نقدی ہمیشہ دھیان سے گنیں۔',
      'ہر ہفتے (یا روزانہ) Settings → Backup & Restore سے بیک اپ لے کر الگ USB ڈرائیو میں محفوظ کریں۔',
      'کمپیوٹر کی تاریخ یا وقت خود تبدیل نہ کریں — بل نمبر، رپورٹس اور لائسنس درست وقت پر چلتے ہیں۔',
      'گاہک کو رسید صرف "Complete Bill" دبانے اور بل محفوظ ہونے کی تصدیق کے بعد دیں۔',
    ],
    supportInfoTitle: 'سپورٹ معلومات',
    supportInfoSubtitle: 'صرف محفوظ سسٹم تفصیلات (سیلز، گاہک یا پاس ورڈ شامل نہیں)',
    copySupportInfo: 'سپورٹ معلومات کاپی کریں',
    copiedConfirmation: 'کاپی ہو گیا',
    fieldAppVersion: 'ایپ ورژن',
    fieldLicenseId: 'لائسنس آئی ڈی',
    fieldDeviceId: 'ڈیوائس آئی ڈی',
    fieldDbSize: 'ڈیٹا بیس سائز',
    fieldOs: 'آپریٹنگ سسٹم',
    reportTitle: 'مسئلہ رپورٹ کریں',
    reportSubtitle: 'مسئلے کی تفصیل لکھیں اور براہ راست واٹس ایپ سپورٹ پر بھیجیں',
    reportDescLabel: 'کیا مسئلہ پیش آیا؟',
    reportDescPlaceholder: 'مثال: Complete Bill دبانے کے بعد رسید پرنٹ نہیں ہوئی...',
    reportScreenshotLabel: 'اختیاری اسکرین شاٹ (واٹس ایپ چیٹ میں ساتھ منسلک کریں)',
    reportScreenshotHint: 'ابھی کلاؤڈ ٹکٹ سرور موجود نہیں — بھیجنے پر واٹس ایپ تفصیلات کے ساتھ کھل جائے گا، جہاں آپ اسکرین شاٹ خود اٹیچ کر سکتے ہیں۔',
    reportSubmitBtn: 'واٹس ایپ پر بھیجیں',
    reportOfflineNote: 'یہ ہیلپ سینٹر 100% آف لائن کام کرتا ہے۔ انٹرنیٹ صرف واٹس ایپ کھولنے کے لیے درکار ہوتا ہے۔',
    reportRequiredError: 'بھیجنے سے پہلے مسئلے کی تفصیل لکھیں۔',
    offlineBadge: 'آف لائن دستیاب',
  },
}

const LANG_KEY = 'vertexia_help_lang'
const LANG_EVENT = 'vertexia:help-lang-changed'

export function getHelpLang(): HelpLang {
  try {
    return localStorage.getItem(LANG_KEY) === 'ur' ? 'ur' : 'en'
  } catch {
    return 'en'
  }
}

export function setHelpLang(lang: HelpLang): void {
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(LANG_EVENT))
  }
}

export function useHelpTranslation(): {
  lang: HelpLang
  setLang: (next: HelpLang) => void
  t: HelpTranslations
} {
  const [lang, setStateLang] = useState<HelpLang>(() => getHelpLang())
  useEffect(() => {
    const sync = () => setStateLang(getHelpLang())
    window.addEventListener(LANG_EVENT, sync)
    return () => window.removeEventListener(LANG_EVENT, sync)
  }, [])
  return {
    lang,
    setLang: (next: HelpLang) => setHelpLang(next),
    t: helpDictionary[lang],
  }
}
