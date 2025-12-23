import { FunderPattern } from "./types";

export const FUNDER_PATTERNS: FunderPattern[] = [
  // ═══════════════════════════════════════════════════════════════
  //                          China
  // ═══════════════════════════════════════════════════════════════
  {
    id: "NSFC",
    name: "National Natural Science Foundation of China",
    aliases: [
      "国家自然科学基金",
      "基金委",
      "NNSFC",
      "Natural Science Foundation of China",
      "NSFC of China",
    ],
    patterns: [
      // NSFC Grant No.: 8-11 digits, first digit 1-8 (Dept), U (Joint), 9 (Major)
      // Examples: 12125507 (8), 12361141819 (11), U2032102 (U+7)
      // Note: Some papers misspell as "Nature" instead of "Natural", or use plural "Foundations"
      /(?:NSFC|国家自然科学基金|基金委|NNSF[C]?|Natura?l?\s+(?:Science\s+)?Foundations?\s+of\s+China|National\s+Nature\s+Science\s+Foundations?\s+of\s+China)[^0-9]{0,40}(?:No\.?\s*|Grant\s*(?:No\.?)?\s*|Nos?\.?\s*)?([1-9U]\d{7,10})/gi,
      /(?:supported|funded|granted)\s+by\s+(?:the\s+)?NSFC[^0-9]{0,20}([1-9U]\d{7,10})/gi,
      /([1-9U]\d{7,10})\s*(?:\(NSFC\)|from\s+NSFC)/gi,
    ],
    // Match subsequent numbers in a list: comma, semicolon, 'and', '、', '&', '/'
    // Support "No." prefix: ", No. 12447101" or ", and No. 12361141819" or " and No. 12247107"
    nextPattern: /^\s*(?:[,;、/&]\s*(?:and\s+)?|and\s+)(?:No\.?\s*)?([1-9U]\d{7,10})/,
    priority: 100,
    category: "china",
    hasGrantNumber: true,
  },
  {
    id: "MoST",
    name: "Ministry of Science and Technology of China",
    aliases: [
      "科技部",
      "国家重点研发计划",
      "National Key R&D Program of China",
      "National Key R&D Program",
      "National Key Research and Development Program",
      "MOST",
      "NKRDP",
      "Ministry of Science and Technology",
    ],
    patterns: [
      // Full English: "the National Key R&D Program of China (Grant No. 2024YFA1234567)"
      /(?:the\s+)?National\s+Key\s+(?:R&D|Research\s+and\s+Development)\s+Program(?:\s+of\s+China)?[^0-9]{0,30}(?:Grant\s*(?:No\.?)?\s*|No\.?\s*)?(20[12]\d{1}YF[A-Z]\d{7})/gi,
      // Chinese: "国家重点研发计划 (2024YFA1234567)"
      /(?:国家重点研发|重点研发计划)[^0-9]{0,30}(20[12]\d{1}YF[A-Z]\d{7})/gi,
      // Short: "MoST Grant No. 2024YFA1234567"
      /(?:MoST|MOST|NKRDP)[^0-9]{0,30}(?:Grant\s*(?:No\.?)?\s*)?(20[12]\d{1}YF[A-Z]\d{7})/gi,
      // Direct match (unique format)
      /(20[12]\d{1}YF[A-Z]\d{7})/g,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(?:No\.?\s*)?(20[12]\d{1}YF[A-Z]\d{7})/,
    priority: 95,
    category: "china",
  },
  {
    id: "MoST-973",
    name: "National Basic Research Program of China (973)",
    aliases: [
      "973计划",
      "国家重点基础研究发展计划",
      "973 Program",
      "National Basic Research Program",
    ],
    patterns: [
      /(?:973|国家重点基础研究)[^0-9]{0,20}(20[01]\dCB\d{6})/gi,
      /(20[01]\dCB\d{6})/g,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(20[01]\dCB\d{6})/,
    priority: 90,
    category: "china",
  },
  {
    id: "MoST-863",
    name: "National High Technology R&D Program of China (863)",
    aliases: ["863计划", "国家高技术研究发展计划", "863 Program"],
    patterns: [/(?:863|国家高技术)[^0-9]{0,20}(20[01]\dAA\d{6})/gi],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(20[01]\dAA\d{6})/,
    priority: 85,
    category: "china",
  },
  {
    id: "CAS",
    name: "Chinese Academy of Sciences",
    aliases: [
      "中国科学院",
      "中科院",
      "CAS",
      "Strategic Priority Research Program",
      "战略性先导科技专项",
    ],
    patterns: [
      // Context: CAS followed by grant number
      /(?:中科院|中国科学院|CAS|Strategic\s+Priority|Chinese\s+Academy\s+of\s+Sciences)[^0-9]{0,40}(?:Grant\s*(?:No\.?)?\s*)?(XD[A-Z]{1,2}\d{2,8})/gi,
      // Direct match for Strategic Priority Research Program (unique format)
      // XDA/XDB/XDC + 8 digits: XDA15020300; XDPB + 2 digits: XDPB09
      /(XD[A-Z]{1,2}\d{2,8})/g,
      // CAS specific prefixes with context (to ensure correct capture)
      /(?:中科院|中国科学院|CAS|Chinese\s+Academy\s+of\s+Sciences)[^0-9]{0,40}(?:Grant\s*(?:No\.?)?\s*)?(YSBR-\d{2,4})/gi,
      /(YSBR-\d{2,4})/gi, // Basic Research Annual Project - direct match
      /(QYZD[BJ]-SSW-?[A-Z]{0,6}\d{1,5})/gi, // Frontier Science Key Research Program
      /(ZDBS-LY-[A-Z]{2,4}\d{2,4})/gi, // Key Deployment Project
      /(JCYJ\d{8,12})/gi, // Basic Frontier Research
      /(ZDKYYQ\d{8,12})/gi, // Stable Support for Basic Research
      // Other CAS projects with context - exclude known prefixes to avoid truncation
      /(?:中科院|CAS)[^0-9]{0,20}(?:Grant\s*(?:No\.?)?\s*)?(?!XD|YSBR|QYZD|ZDBS|JCYJ|ZDKY)([A-Z]{2,6}[-]?\d{2,8})/gi,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(?:No\.?\s*)?(XD[A-Z]{1,2}\d{2,8}|YSBR-\d{2,4}|QYZD[BJ]-SSW-?[A-Z]{0,6}\d{1,5}|ZDBS-LY-[A-Z]{2,4}\d{2,4})/,
    priority: 92,
    category: "china",
  },
  {
    id: "CAS-PIFI",
    name: "CAS President's International Fellowship Initiative",
    aliases: ["国际人才计划", "PIFI", "President's International Fellowship"],
    patterns: [
      // PIFI grant format: 2024PVA0004, 2025PD0087
      // Y suffix indicates continuation year (延续资助): 2024PVA0004_Y1 = Year 1 of continuation
      // PDF text layer may convert underscore to space or lose it: _Y1 → " Y1" or "Y1"
      /(?:PIFI|国际人才计划|President's\s+International\s+Fellowship)[^0-9]{0,30}(?:Grant\s*)?(?:Nos?\.?\s*)?(20[12]\d[A-Z]{2,4}\d{4,6}(?:[\s_]?Y\d)?)/gi,
    ],
    // Handle optional Y suffix (continuation year) before comma/and
    nextPattern: /^\s*(?:[\s_]?Y\d)?\s*(?:[,;、/&]\s*(?:and\s+)?|and\s+)(?:No\.?\s*)?(20[12]\d[A-Z]{2,4}\d{4,6}(?:[\s_]?Y\d)?)/,
    priority: 80,
    category: "china",
  },
  {
    id: "CAS-YIPA",
    name: "Youth Innovation Promotion Association CAS",
    aliases: [
      "青年创新促进会",
      "青促会",
      "Youth Innovation Promotion Association",
      "YIPA",
    ],
    patterns: [
      /(?:青年创新促进会|青促会|Youth\s+Innovation\s+Promotion|YIPA)[^0-9]{0,30}(Y?\d{6,7})/gi,
      /(?:CAS|中科院)[^0-9]{0,20}(?:青年创新促进会|YIPA)[^0-9]{0,20}(Y?\d{6,7})/gi,
    ],
    priority: 78,
    category: "china",
  },
  {
    id: "CCAST",
    name: "China Center of Advanced Science and Technology",
    aliases: ["中国高等科学技术中心", "CCAST", "China Center of Advanced Science"],
    patterns: [
      // Only identify organization name
      /(?:CCAST|中国高等科学技术中心)[^0-9]{0,30}/gi,
    ],
    priority: 65,
    category: "china",
    hasGrantNumber: false,
  },
  {
    id: "CAEP",
    name: "China Academy of Engineering Physics",
    aliases: [
      "中国工程物理研究院",
      "中物院",
      "CAEP",
      "China Academy of Engineering Physics",
    ],
    patterns: [
      // CAEP might have internal project numbers, but no public standard format
      /(?:CAEP|中国工程物理研究院|中物院)[^0-9]{0,30}([A-Z]{2,4}\d{6,10})?/gi,
    ],
    priority: 70,
    category: "china",
    hasGrantNumber: false,
  },
  {
    id: "CPSF",
    name: "China Postdoctoral Science Foundation",
    aliases: [
      "博士后科学基金",
      "博士后基金",
      "China Postdoctoral",
      "Postdoctoral Science Foundation",
    ],
    patterns: [
      // GZC format (国资委站): GZC20232773 - must match first to capture GZC prefix
      /(?:博士后[^0-9]{0,20}|(?:China\s+)?Postdoctoral[^0-9]{0,100}|CPSF[^0-9]{0,20})(?:No\.?\s*)?(GZC20[12]\d{5,7})/gi,
      // Standard format with M/T/G: 2023M74360, 2024T12345678
      /(?:博士后[^0-9]{0,20}|(?:China\s+)?Postdoctoral[^0-9]{0,100}|CPSF[^0-9]{0,20})(?:No\.?\s*)?(20[12]\d[MTG]\d{4,7})/gi,
      // Direct match for common formats
      /(GZC20[12]\d{5,7})/g, // GZC20232773
      /(20[12]\d[MT]\d{5,7})/g, // 2023M74360, 2024T1234567
    ],
    nextPattern: /^\s*(?:[,;、/&]\s*(?:and\s+)?|and\s+)(?:No\.?\s*)?(GZC20[12]\d{5,7}|20[12]\d[MTG]\d{4,7})/,
    priority: 80,
    category: "china",
  },
  {
    id: "MoE",
    name: "Ministry of Education of China",
    aliases: ["教育部", "人文社科基金", "MOE", "Ministry of Education"],
    patterns: [
      /(?:教育部|人文社科|MOE|Ministry\s+of\s+Education)[^0-9]{0,30}(\d{2}YJ[ABC]\d{6})/gi,
    ],
    priority: 70,
    category: "china",
  },
  {
    id: "NTIEP",
    name: "National Training Program of Innovation and Entrepreneurship for Undergraduates",
    aliases: [
      "大学生创新创业训练计划",
      "大创项目",
      "国创",
      "National Training Program of Innovation",
      "Innovation and Entrepreneurship",
    ],
    patterns: [
      // Format: 202414430004 = year(4) + school code(5) + project number(3) = 12 digits
      /(?:大学生创新创业|大创|国创|National\s+Training\s+Program\s+of\s+Innovation|Innovation\s+and\s+Entrepreneurship)[^0-9]{0,80}(?:Grant\s*(?:No\.?)?\s*|No\.?\s*)?(20[12]\d{9})/gi,
      // Direct match with year prefix 2020-2029
      /(20[2][0-9]\d{8})/g, // 202414430004
    ],
    nextPattern: /^\s*(?:[,;、/&]\s*(?:and\s+)?|and\s+)(?:No\.?\s*)?(20[2][0-9]\d{8})/,
    priority: 65,
    category: "china",
  },
  // Provincial Funds
  {
    id: "STCSM",
    name: "Shanghai Science and Technology Commission",
    aliases: [
      "上海市科委",
      "上海市科学技术委员会",
      "Shanghai S&T Commission",
    ],
    patterns: [
      /(?:上海市科委|Shanghai\s+(?:S&T|Science)[^0-9]{0,20})(\d{2}[A-Z]{2}\d{6})/gi,
    ],
    priority: 60,
    category: "china",
  },
  {
    id: "BNSF",
    name: "Beijing Natural Science Foundation",
    aliases: ["北京市自然科学基金", "Beijing NSF"],
    patterns: [
      /(?:北京市自然科学基金|Beijing\s+(?:Natural\s+)?Science\s+Foundation)[^0-9]{0,20}(\d{7})/gi,
    ],
    priority: 60,
    category: "china",
  },
  {
    id: "GDSF",
    name: "Guangdong Natural Science Foundation",
    aliases: ["广东省自然科学基金", "Guangdong NSF"],
    patterns: [
      /(?:广东省自然科学基金|Guangdong[^0-9]{0,20})(20[12]\d[AB]\d{10})/gi,
    ],
    priority: 60,
    category: "china",
  },
  {
    id: "ZJNSF",
    name: "Zhejiang Natural Science Foundation",
    aliases: ["浙江省自然科学基金", "Zhejiang NSF"],
    patterns: [
      /(?:浙江省自然科学基金|Zhejiang[^0-9]{0,20})[^0-9]{0,10}(L[YQ]\d{2}[A-Z]\d{5,6})/gi,
      /(L[YQ]\d{2}[A-Z]\d{5,6})/g, // LY21A050001, LQ22A050001
    ],
    priority: 60,
    category: "china",
  },
  {
    id: "JSSF",
    name: "Jiangsu Natural Science Foundation",
    aliases: ["江苏省自然科学基金", "Jiangsu NSF"],
    patterns: [
      /(?:江苏省自然科学基金|Jiangsu[^0-9]{0,20})[^0-9]{0,10}(BK20\d{6})/gi,
      /(BK20\d{6})/g, // BK20241234
    ],
    priority: 60,
    category: "china",
  },
  {
    id: "SDSF",
    name: "Shandong Natural Science Foundation",
    aliases: ["山东省自然科学基金", "Shandong NSF"],
    patterns: [
      /(?:山东省自然科学基金|Shandong[^0-9]{0,20})[^0-9]{0,10}(ZR20\d{2}[A-Z]{2}\d{3,6})/gi,
      /(ZR20\d{2}[A-Z]{2}\d{3,6})/g, // ZR2024MA001
    ],
    priority: 60,
    category: "china",
  },
  {
    id: "HNSF",
    name: "Hunan Natural Science Foundation",
    aliases: [
      "湖南省自然科学基金",
      "湖南省杰出青年科学基金",
      "Hunan NSF",
      "Distinguished Young Scholars of Hunan",
    ],
    patterns: [
      // Standard NSF and Distinguished Young Scholars (杰青)
      /(?:湖南省自然科学基金|湖南省杰出青年|Hunan[^0-9]{0,30}|Distinguished\s+Young\s+Scholars\s+of\s+Hunan[^0-9]{0,20})[^0-9]{0,10}(20\d{2}JJ\d{4,6})/gi,
      /(20\d{2}JJ\d{4,6})/g, // 2024JJ2007, 2024JJ10001
    ],
    priority: 60,
    category: "china",
  },
  {
    id: "SXSF",
    name: "Shaanxi Natural Science Foundation",
    aliases: ["陕西省自然科学基金", "Shaanxi NSF"],
    patterns: [
      /(?:陕西省自然科学基金|Shaanxi[^0-9]{0,20})[^0-9]{0,10}(20\d{2}J[MQ]-\d{3,4})/gi,
      /(20\d{2}J[MQ]-\d{3,4})/g, // 2024JM-001
    ],
    priority: 60,
    category: "china",
  },
  {
    id: "HBNSF",
    name: "Hebei Natural Science Foundation",
    aliases: ["河北省自然科学基金", "Hebei NSF"],
    patterns: [
      // Format: A2025205018, B2024123456 (letter + year + 6 digits)
      /(?:河北省自然科学基金|Hebei[^0-9]{0,30}Natural\s+Science)[^0-9]{0,20}([A-F]20\d{2}\d{6})/gi,
      /([A-F]20[12]\d{7})/g, // A2025205018
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?([A-F]20[12]\d{7})/,
    priority: 60,
    category: "china",
  },
  {
    id: "HBEdu",
    name: "Hebei Provincial Department of Education",
    aliases: [
      "河北省教育厅",
      "河北省高等学校科学研究项目",
      "Hebei Education Department",
    ],
    patterns: [
      // Youth fund: QN2025063, Key project: ZD2025001, General: KY2024001
      /(?:河北省教育厅|河北省高等学校|Hebei\s+(?:Provincial\s+)?(?:Department\s+of\s+)?Education)[^0-9]{0,30}((?:QN|ZD|KY)20\d{2}\d{3,4})/gi,
      /((?:QN|ZD|KY)20[12]\d{4,5})/g, // QN2025063
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?((?:QN|ZD|KY)20[12]\d{4,5})/,
    priority: 55,
    category: "china",
  },
  {
    id: "FRFCU",
    name: "Fundamental Research Funds for the Central Universities",
    aliases: [
      "中央高校基本科研业务费",
      "中央高校基本科研业务费专项资金",
      "Fundamental Research Funds",
    ],
    patterns: [
      // Format: FRF-BR-19-001A (alphanumeric with hyphens)
      /(?:Fundamental\s+Research\s+Funds\s+for\s+(?:the\s+)?Central\s+Universities).{0,50}?(?:Grants?\s*(?:No\.?)?\s*|No\.?\s*)([A-Z]{2,6}[-][A-Z]{2,4}[-]\d{2}[-]\d{3,4}[A-Z]?)/gi,
      // Various university formats with pure digits: 531118010379, 20720230001, 30920140111010
      /(?:中央高校基本科研业务费|Fundamental\s+Research\s+Funds\s+for\s+(?:the\s+)?Central\s+Universities).{0,50}?(?:Grants?\s*(?:No\.?)?\s*|No\.?\s*)?(\d{9,14})/gi,
      // Some universities use alphanumeric: HIT.NSRIF.2015042
      /(?:中央高校基本科研业务费|Fundamental\s+Research\s+Funds).{0,30}?([A-Z]{2,6}[\.\-]?[A-Z]{0,6}[\.\-]?\d{6,10})/gi,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(\d{9,14}|[A-Z]{2,6}[-][A-Z]{2,4}[-]\d{2}[-]\d{3,4}[A-Z]?)/,
    priority: 55,
    category: "china",
  },
  {
    id: "HEBTU",
    name: "Hebei Normal University Fund",
    aliases: ["河北师范大学基金", "河北师范大学科研基金"],
    patterns: [
      // Format: L2025B09, L2023B09 (L + year + letter + 2 digits)
      /(?:河北师范大学|Hebei\s+Normal\s+University)[^0-9]{0,30}(L20\d{2}[A-Z]\d{2})/gi,
      /(L20[12]\d[A-Z]\d{2})/g, // L2025B09
    ],
    priority: 50,
    category: "china",
  },
  // ─────────────────────────────────────────────────────────────────
  //  Additional Provincial Natural Science Foundations (HEP/Nuclear)
  // ─────────────────────────────────────────────────────────────────
  {
    id: "SCNSF",
    name: "Sichuan Natural Science Foundation",
    aliases: ["四川省自然科学基金", "Sichuan NSF", "四川省科技厅"],
    patterns: [
      // Format: 2024NSFSC0456, 2023NSFSC1234
      /(?:四川省自然科学基金|四川省科技厅|Sichuan[^0-9]{0,30})[^0-9]{0,10}(20\d{2}NSFSC\d{4})/gi,
      /(20[12]\d{1}NSFSC\d{4})/g,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(20[12]\d{1}NSFSC\d{4})/,
    priority: 60,
    category: "china",
  },
  {
    id: "AHNSF",
    name: "Anhui Natural Science Foundation",
    aliases: ["安徽省自然科学基金", "Anhui NSF"],
    patterns: [
      // Format: 2308085MA01, 2108085QA28
      /(?:安徽省自然科学基金|Anhui[^0-9]{0,30}Natural\s+Science)[^0-9]{0,10}(\d{7}[A-Z]{2}\d{2})/gi,
      /(\d{7}[A-Z]{2}\d{2})/g,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(\d{7}[A-Z]{2}\d{2})/,
    priority: 60,
    category: "china",
  },
  {
    id: "LNNSF",
    name: "Liaoning Natural Science Foundation",
    aliases: ["辽宁省自然科学基金", "Liaoning NSF"],
    patterns: [
      // Format: 2023-MS-123, 2024-YGJC-123
      /(?:辽宁省自然科学基金|Liaoning[^0-9]{0,30})[^0-9]{0,10}(20\d{2}-[A-Z]{2,4}-\d{3})/gi,
      /(20[12]\d-[A-Z]{2,4}-\d{3})/g,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(20[12]\d-[A-Z]{2,4}-\d{3})/,
    priority: 60,
    category: "china",
  },
  // ─────────────────────────────────────────────────────────────────
  //  State Key Laboratory Open Funds (重点实验室开放课题)
  // ─────────────────────────────────────────────────────────────────
  {
    id: "SKL",
    name: "State Key Laboratory Open Fund",
    aliases: [
      "国家重点实验室开放课题",
      "重点实验室开放基金",
      "State Key Laboratory",
      "SKL",
    ],
    patterns: [
      // Common formats: SKLTP-2024-01, SKLNPT2023002, SKL-2024-001
      // SKLTP = Theoretical Physics, SKLNPT = Nuclear Physics & Technology
      /(?:State\s+Key\s+Lab(?:oratory)?|国家重点实验室|重点实验室开放)[^0-9]{0,50}(?:Grant\s*(?:No\.?)?\s*|No\.?\s*)?(SKL[A-Z]{0,4}[-]?20\d{2}[-]?\d{2,4})/gi,
      /(SKL[A-Z]{0,4}[-]?20[12]\d[-]?\d{2,4})/g,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(SKL[A-Z]{0,4}[-]?20[12]\d[-]?\d{2,4})/,
    priority: 65,
    category: "china",
  },
  // ─────────────────────────────────────────────────────────────────
  //  NSFC Joint Programs (国际合作项目)
  // ─────────────────────────────────────────────────────────────────
  {
    id: "NSFC-DFG",
    name: "NSFC-DFG Sino-German Joint Research Program",
    aliases: ["NSFC-DFG", "中德合作", "Sino-German"],
    patterns: [
      /(?:NSFC-DFG|中德合作|Sino-German)[^0-9]{0,50}(?:Grant\s*(?:No\.?)?\s*)?([1-9U]\d{7,10})/gi,
    ],
    priority: 98,
    category: "china",
  },
  {
    id: "NSFC-JSPS",
    name: "NSFC-JSPS Sino-Japanese Joint Research Program",
    aliases: ["NSFC-JSPS", "中日合作", "Sino-Japanese"],
    patterns: [
      /(?:NSFC-JSPS|中日合作|Sino-Japanese)[^0-9]{0,50}(?:Grant\s*(?:No\.?)?\s*)?([1-9U]\d{7,10})/gi,
    ],
    priority: 98,
    category: "china",
  },
  {
    id: "NSFC-RSF",
    name: "NSFC-RSF Sino-Russian Joint Research Program",
    aliases: ["NSFC-RSF", "中俄合作", "Sino-Russian"],
    patterns: [
      /(?:NSFC-RSF|中俄合作|Sino-Russian)[^0-9]{0,50}(?:Grant\s*(?:No\.?)?\s*)?([1-9U]\d{7,10})/gi,
    ],
    priority: 98,
    category: "china",
  },
  // ─────────────────────────────────────────────────────────────────
  //  Talent Programs (人才计划 - typically no grant numbers)
  // ─────────────────────────────────────────────────────────────────
  {
    id: "Changjiang",
    name: "Changjiang Scholars Program",
    aliases: [
      "长江学者奖励计划",
      "长江学者",
      "Changjiang Scholar",
      "Yangtze River Scholar",
    ],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:长江学者|Changjiang\s+Scholar|Yangtze\s+River\s+Scholar)/gi,
      /(?:长江学者|Changjiang\s+Scholar|Yangtze\s+River\s+Scholar).{0,50}(?:Program|Award|计划)/gi,
    ],
    priority: 60,
    category: "china",
    hasGrantNumber: false,
  },
  {
    id: "TenThousand",
    name: "Ten Thousand Talents Program",
    aliases: [
      "万人计划",
      "国家高层次人才特殊支持计划",
      "Ten Thousand Talents",
      "National High-level Talents",
    ],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:万人计划|Ten\s+Thousand\s+Talents|National\s+High-level\s+Talents)/gi,
      /(?:万人计划|Ten\s+Thousand\s+Talents).{0,50}(?:Program|计划)/gi,
    ],
    priority: 60,
    category: "china",
    hasGrantNumber: false,
  },
  {
    id: "ThousandYouth",
    name: "Thousand Young Talents Program",
    aliases: [
      "青年千人计划",
      "青年千人",
      "Thousand Young Talents",
      "Young Thousand Talents",
    ],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:青年千人|Thousand\s+Young\s+Talents|Young\s+Thousand\s+Talents)/gi,
      /(?:青年千人|Thousand\s+Young\s+Talents).{0,50}(?:Program|计划)/gi,
    ],
    priority: 60,
    category: "china",
    hasGrantNumber: false,
  },
  // ─────────────────────────────────────────────────────────────────
  //  Major Science Facilities & Institutes (大科学装置/研究所)
  // ─────────────────────────────────────────────────────────────────
  {
    id: "IHEP",
    name: "Institute of High Energy Physics",
    aliases: [
      "中科院高能物理研究所",
      "高能所",
      "IHEP",
      "Institute of High Energy Physics",
    ],
    patterns: [
      // IHEP internal projects typically have specific formats
      /(?:supported|funded|acknowledge).{0,50}(?:IHEP|高能所|高能物理研究所)/gi,
      /(?:IHEP|高能所|高能物理研究所).{0,50}(?:grant|support|project|资助)/gi,
      // Specific IHEP project format if any (e.g., Y9291220K2)
      /(?:IHEP|高能所)[^0-9]{0,30}(?:Grant\s*(?:No\.?)?\s*)?([YE]\d{7,10}[A-Z]?\d?)/gi,
    ],
    priority: 70,
    category: "china",
    hasGrantNumber: false,
  },
  {
    id: "LHAASO",
    name: "Large High Altitude Air Shower Observatory",
    aliases: ["LHAASO", "高海拔宇宙线观测站", "拉索"],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:LHAASO|高海拔宇宙线|拉索)/gi,
      /(?:LHAASO|高海拔宇宙线观测站).{0,50}(?:grant|support|project)/gi,
    ],
    priority: 65,
    category: "china",
    hasGrantNumber: false,
  },
  {
    id: "CSNS",
    name: "China Spallation Neutron Source",
    aliases: ["CSNS", "中国散裂中子源", "散裂中子源"],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:CSNS|散裂中子源)/gi,
      /(?:CSNS|中国散裂中子源).{0,50}(?:grant|support|project)/gi,
    ],
    priority: 65,
    category: "china",
    hasGrantNumber: false,
  },
  {
    id: "BEPC",
    name: "Beijing Electron Positron Collider",
    aliases: ["BEPC", "BEPCII", "北京正负电子对撞机"],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:BEPC|北京正负电子对撞机)/gi,
      /(?:BEPC|BEPCII|北京正负电子对撞机).{0,50}(?:grant|support|project)/gi,
    ],
    priority: 65,
    category: "china",
    hasGrantNumber: false,
  },
  // ─────────────────────────────────────────────────────────────────
  //  Astronomy/Cosmology Institutes
  // ─────────────────────────────────────────────────────────────────
  {
    id: "NAOC",
    name: "National Astronomical Observatories of China",
    aliases: [
      "国家天文台",
      "NAOC",
      "National Astronomical Observatories",
    ],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:NAOC|国家天文台)/gi,
      /(?:NAOC|国家天文台).{0,50}(?:grant|support|project|资助)/gi,
    ],
    priority: 65,
    category: "china",
    hasGrantNumber: false,
  },
  {
    id: "PMO",
    name: "Purple Mountain Observatory",
    aliases: ["紫金山天文台", "PMO", "Purple Mountain Observatory"],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:PMO|紫金山天文台|Purple\s+Mountain)/gi,
      /(?:PMO|紫金山天文台).{0,50}(?:grant|support|project)/gi,
    ],
    priority: 65,
    category: "china",
    hasGrantNumber: false,
  },
  {
    id: "SHAO",
    name: "Shanghai Astronomical Observatory",
    aliases: ["上海天文台", "SHAO", "Shanghai Astronomical Observatory"],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:SHAO|上海天文台|Shanghai\s+Astronomical)/gi,
      /(?:SHAO|上海天文台).{0,50}(?:grant|support|project)/gi,
    ],
    priority: 65,
    category: "china",
    hasGrantNumber: false,
  },

  // ═══════════════════════════════════════════════════════════════
  //                          USA
  // ═══════════════════════════════════════════════════════════════
  {
    id: "DOE",
    name: "U.S. Department of Energy",
    aliases: [
      "Department of Energy",
      "DOE",
      "Office of Science",
      "Office of High Energy Physics",
      "QuantISED",
    ],
    patterns: [
      // DE-SC0015266 format (most common, with DE- prefix) - must be first to capture full number
      /(?:DOE|Department\s+of\s+Energy|Office\s+of\s+(?:Science|High\s+Energy))[^0-9]{0,50}(?:(?:Grant|Award|contract)\s*(?:No\.?)?\s*)?(DE-[A-Z]{2}\d{7})/gi,
      // Contract format: DE-AC02-06CH11357
      /(?:DOE|Department\s+of\s+Energy)[^0-9]{0,50}(?:contracts?\s*)?(DE-[A-Z]{2}\d{2}-\d{2}[A-Z]{2}\d{5})/gi,
      // QuantISED format: 89243024CSC000002
      /(?:DOE|Department\s+of\s+Energy|QuantISED)[^0-9]{0,50}(?:No\.?\s*)?(\d{8}[A-Z]{3}\d{6})/gi,
      // Direct match patterns
      /(DE-[A-Z]{2}\d{7})/g, // DE-SC0015266
      /(DE-[A-Z]{2}\d{2}-\d{2}[A-Z]{2}\d{5})/g, // DE-AC02-06CH11357
      /(\d{8}[A-Z]{3}\d{6})/g, // 89243024CSC000002 (QuantISED)
    ],
    nextPattern: /^\s*(?:[,;、/&]\s*(?:and\s+)?|and\s+)(?:No\.?\s*)?(DE-[A-Z]{2}\d{7}|DE-[A-Z]{2}\d{2}-\d{2}[A-Z]{2}\d{5}|\d{8}[A-Z]{3}\d{6})/,
    priority: 90,
    category: "us",
  },
  {
    id: "NSF",
    name: "U.S. National Science Foundation",
    aliases: ["National Science Foundation", "NSF"],
    patterns: [
      /(?:NSF|National\s+Science\s+Foundation)[^0-9]{0,30}(?:Grant\s*(?:No\.?)?\s*)?(PHY[-]?\d{7})/gi,
      /(?:NSF|National\s+Science\s+Foundation)[^0-9]{0,30}(?:Grant\s*(?:No\.?)?\s*)?([A-Z]{3,4}[-]?\d{7})/gi,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(?:No\.?\s*)?([A-Z]{3,4}[-]?\d{7}|PHY[-]?\d{7})/,
    priority: 90,
    category: "us",
  },
  {
    id: "NIH",
    name: "National Institutes of Health",
    aliases: ["NIH", "National Institutes of Health"],
    patterns: [/(?:NIH)[^0-9]{0,20}([A-Z]\d{2}[A-Z]{2}\d{6})/gi],
    priority: 75,
    category: "us",
  },

  // ═══════════════════════════════════════════════════════════════
  //                          Europe
  // ═══════════════════════════════════════════════════════════════
  {
    id: "ERC",
    name: "European Research Council",
    aliases: [
      "European Research Council",
      "ERC",
      "Horizon 2020",
      "Horizon Europe",
      "EU Horizon 2020",
    ],
    patterns: [
      // ERC and European Research Council patterns
      /(?:ERC|European\s+Research\s+Council)[^0-9]{0,100}(?:Grant\s*(?:No\.?)?\s*|Agreement\s*(?:No\.?)?\s*)?(\d{6,9})/gi,
      // EU Horizon 2020 / Horizon Europe patterns with grant agreement
      // Use lazy .{0,150}? to allow digits in middle text (e.g., "STRONG-2020")
      /(?:EU\s+)?Horizon\s+(?:2020|Europe).{0,150}?(?:grant\s+)?agreement\s*(?:No\.?)?\s*(\d{6,9})/gi,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?(?:No\.?\s*)?(\d{6,9})/,
    priority: 85,
    category: "eu",
  },
  {
    id: "MICINN",
    name: "Spanish Ministry of Science and Innovation",
    aliases: ["MICINN", "Ministerio de Ciencia", "Spanish Ministry of Science"],
    patterns: [
      /(?:Spanish\s+Ministry|MICINN|Ministerio\s+de\s+Ciencia)[^0-9]{0,50}(?:Grant\s+no\.?|PID)?\s*([A-Z0-9-]{10,})/gi,
    ],
    nextPattern: /^\s*[,;、/&]\s*(?:and\s+)?([A-Z0-9-]{10,})/,
    priority: 80,
    category: "eu",
  },
  {
    id: "JuntaAndalucia",
    name: "Junta de Andalucía",
    aliases: ["Junta de Andalucía", "Junta de Andalucia"],
    patterns: [
      /(?:Junta\s+de\s+Andaluc[ií]a)[^0-9]{0,50}(?:Grant\s+no\.?)?\s*([A-Z0-9-\s]{5,})/gi,
    ],
    priority: 75,
    category: "eu",
  },
  {
    id: "Helmholtz",
    name: "Helmholtz Association",
    aliases: ["Helmholtz", "Helmholtz-Zentrum"],
    patterns: [
      // Only match with context to avoid false positives
      /(?:supported|funded|acknowledge).{0,50}(?:Helmholtz)/gi,
      /(?:Helmholtz).{0,50}(?:grant|support)/gi,
    ],
    priority: 75,
    category: "eu",
    hasGrantNumber: false,
  },
  {
    id: "DFG",
    name: "Deutsche Forschungsgemeinschaft",
    aliases: ["German Research Foundation", "DFG", "CRC", "TRR", "SFB"],
    patterns: [
      // Collaborative Research Centres, Research Units, Transregional CRC, etc.
      // SFB (Sonderforschungsbereich), TRR (Transregional CRC), FOR (Research Unit),
      // GRK (Graduiertenkolleg), SPP (Priority Programme), EXC (Excellence Cluster)
      /(?:DFG|Deutsche\s+Forschungsgemeinschaft|German\s+Research\s+Foundation)[^0-9]{0,50}((?:SFB|TRR|FOR|GRK|SPP|EXC)\s?\d{2,4})/gi,
      // Direct "DFG Grant No. TRR110" pattern
      /(?:DFG)[^0-9A-Z]{0,30}(?:Grant\s*(?:No\.?)?\s*)?((?:SFB|TRR|FOR|GRK|SPP|EXC)\s?\d{2,4})/gi,
      // Walter-Benjamin, Emmy Noether, and other grants with 9-digit numbers
      /(?:DFG|Deutsche\s+Forschungsgemeinschaft|German\s+Research\s+Foundation)[^0-9]{0,60}(?:Grant\s*(?:No\.?)?\s*)?(\d{9})/gi,
      // Direct DFG + number
      /(?:DFG)[^0-9]{0,30}(?:Project\s*)?(\d{9})/gi,
      // Direct match for SFB/TRR/CRC when appearing independently or after numeric ID
      // e.g., "279384907 — SFB 1245" or standalone "SFB 1245"
      /((?:SFB|TRR|CRC)\s?\d{2,4})/g,
    ],
    nextPattern: /^\s*(?:[,;、/&]\s*(?:and\s+)?|and\s+)(?:No\.?\s*)?((?:SFB|TRR|FOR|GRK|SPP|EXC)\s?\d{2,4}|\d{9})/,
    priority: 80,
    category: "eu",
  },
  {
    id: "BMBF",
    name: "German Federal Ministry of Education and Research",
    aliases: [
      "BMBF",
      "Bundesministerium für Bildung und Forschung",
      "Federal Ministry of Education and Research",
    ],
    patterns: [
      // BMBF grant format: 05P24RDB, 05P21PMCC1, 05H18WOCA3
      // Pattern: 05 + letter (P/H) + 2 digits + alphanumeric (3-6 chars)
      /(?:BMBF|Bundesministerium\s+für\s+Bildung|Federal\s+Ministry\s+of\s+Education\s+and\s+Research)[^0-9]{0,50}(?:Grant\s*(?:No\.?)?\s*)?(05[A-Z]\d{2}[A-Z0-9]{3,6})/gi,
      // Direct match
      /(05[PH]\d{2}[A-Z0-9]{3,6})/g,
    ],
    nextPattern: /^\s*(?:[,;、/&]\s*(?:and\s+)?|and\s+)(?:No\.?\s*)?(05[A-Z]\d{2}[A-Z0-9]{3,6})/,
    priority: 78,
    category: "eu",
  },
  {
    id: "MKW-NRW",
    name: "Ministry of Culture and Science of North Rhine-Westphalia",
    aliases: ["MKW NRW", "MKW-NRW", "NRW", "Ministerium für Kultur und Wissenschaft"],
    patterns: [
      // NRW funding code: NW21-024-A, NW22-123-B, etc.
      /(?:MKW\s*NRW|NRW)[^0-9]{0,40}(?:funding\s+code|code|Grant)?\s*(NW\d{2}-\d{3}-[A-Z])/gi,
      /(NW\d{2}-\d{3}-[A-Z])/g,
    ],
    priority: 70,
    category: "eu",
  },
  {
    id: "STFC",
    name: "UK Science and Technology Facilities Council",
    aliases: ["STFC", "Science and Technology Facilities Council"],
    patterns: [/(?:STFC)[^0-9]{0,20}(ST\/[A-Z]\d{6}\/\d)/gi],
    priority: 75,
    category: "eu",
  },
  {
    id: "INFN",
    name: "Istituto Nazionale di Fisica Nucleare",
    aliases: ["INFN", "Italian National Institute for Nuclear Physics"],
    patterns: [
      // Only identify organization name
      /(?:supported|funded|acknowledge).{0,50}(?:INFN|Istituto\s+Nazionale)/gi,
      /(?:INFN|Istituto\s+Nazionale).{0,50}(?:grant|support)/gi,
    ],
    priority: 70,
    category: "eu",
    hasGrantNumber: false,
  },
  {
    id: "FWO",
    name: "Research Foundation Flanders",
    aliases: ["FWO", "Fonds Wetenschappelijk Onderzoek"],
    patterns: [/(?:FWO)[^0-9]{0,20}(G\.\d{4}\.\d{2}N)/gi],
    priority: 70,
    category: "eu",
  },
  {
    id: "ANR",
    name: "French National Research Agency",
    aliases: ["ANR", "Agence Nationale de la Recherche"],
    patterns: [/(?:ANR)[^0-9]{0,20}(ANR-\d{2}-[A-Z]{4}-\d{4})/gi],
    priority: 70,
    category: "eu",
  },
  {
    id: "SNSF",
    name: "Swiss National Science Foundation",
    aliases: ["SNSF", "SNF", "Swiss NSF", "Schweizerischer Nationalfonds"],
    patterns: [
      // SNF contract format: 200021-212729, 200020_215166, etc.
      /(?:SNSF|SNF|Swiss\s+(?:National\s+)?Science\s+Foundation)[^0-9]{0,40}(?:contract|grant|project)?\s*(?:No\.?\s*)?(\d{6}[-_]\d{6})/gi,
      // Short format: 6 digits
      /(?:SNSF|SNF|Swiss\s+(?:National\s+)?Science\s+Foundation)[^0-9]{0,30}(?:No\.?\s*)?(\d{6})/gi,
    ],
    priority: 70,
    category: "eu",
  },
  {
    id: "VolkswagenStiftung",
    name: "Volkswagen Foundation",
    aliases: ["VolkswagenStiftung", "Volkswagen Foundation", "VW Foundation", "VW Stiftung"],
    patterns: [
      // Grant number format: 93562, etc.
      /(?:VolkswagenStiftung|Volkswagen\s*(?:Foundation|Stiftung)|VW\s*(?:Foundation|Stiftung))[^0-9]{0,50}(?:Grant\s*(?:No\.?)?\s*|No\.?\s*)?(\d{5,6})/gi,
    ],
    nextPattern: /^\s*(?:[,;、/&]\s*(?:and\s+)?|and\s+)(?:No\.?\s*)?(\d{5,6})/,
    priority: 70,
    category: "eu",
  },

  // ═══════════════════════════════════════════════════════════════
  //                       Asia (Other)
  // ═══════════════════════════════════════════════════════════════
  {
    id: "JSPS",
    name: "Japan Society for the Promotion of Science",
    aliases: [
      "JSPS",
      "KAKENHI",
      "科研费",
      "Japan Society for the Promotion of Science",
      "Grants-in-Aid for Scientific Research",
    ],
    patterns: [
      // With context: JSPS/KAKENHI followed by grant number
      /(?:JSPS|KAKENHI|Grants-in-Aid)[^0-9]{0,50}(?:Grants?\s*)?(?:No\.?\s*)?(JP\d{2}[A-Z]\d{5})/gi,
      /(?:JSPS|KAKENHI|Grants-in-Aid)[^0-9]{0,50}(?:No\.?\s*)?(\d{2}[A-Z]\d{5})/gi,
      // Direct match
      /(JP\d{2}[A-Z]\d{5})/g, // JP23H05439
    ],
    nextPattern: /^\s*(?:[,;、/&]\s*(?:and\s+)?|and\s+)(?:No\.?\s*)?(JP\d{2}[A-Z]\d{5}|\d{2}[A-Z]\d{5})/,
    priority: 80,
    category: "asia",
  },
  {
    id: "JST",
    name: "Japan Science and Technology Agency",
    aliases: ["JST", "科学技術振興機構", "SPRING", "Moonshot"],
    patterns: [
      // JST grant formats: JPMJFS2123, JPMJSP2132, JPMJMS2023
      /(?:JST|Japan\s+Science\s+and\s+Technology)[^0-9]{0,50}(?:Grant\s*(?:No\.?)?\s*)?(JPMJ[A-Z]{2}\d{4})/gi,
      // Direct match
      /(JPMJ[A-Z]{2}\d{4})/g, // JPMJFS2123
    ],
    nextPattern: /^\s*(?:[,;、/&]\s*(?:and\s+)?|and\s+)(?:No\.?\s*)?(JPMJ[A-Z]{2}\d{4})/,
    priority: 78,
    category: "asia",
  },
  {
    id: "MEXT",
    name: "Japan Ministry of Education, Culture, Sports, Science and Technology",
    aliases: ["MEXT", "文部科学省"],
    patterns: [
      // Only identify organization name
      /(?:MEXT|文部科学省)[^0-9]{0,30}/gi,
    ],
    priority: 70,
    category: "asia",
    hasGrantNumber: false,
  },
  {
    id: "KEK",
    name: "High Energy Accelerator Research Organization",
    aliases: ["KEK", "高エネルギー加速器研究機構"],
    patterns: [
      // Only identify organization name with context
      /(?:supported|funded|acknowledge).{0,50}(?:KEK)/gi,
      /(?:KEK).{0,50}(?:grant|support)/gi,
    ],
    priority: 70,
    category: "asia",
    hasGrantNumber: false,
  },
  {
    id: "NRF-KR",
    name: "National Research Foundation of Korea",
    aliases: ["NRF", "Korea NRF", "National Research Foundation of Korea"],
    patterns: [
      /(?:NRF|National\s+Research\s+Foundation\s+of\s+Korea)[^0-9]{0,20}(NRF-\d{4}-\d{5})/gi,
    ],
    priority: 75,
    category: "asia",
  },
  {
    id: "MOST-TW",
    name: "Taiwan Ministry of Science and Technology",
    aliases: ["MOST Taiwan", "Taiwan NSC", "國科會"],
    patterns: [
      /(?:MOST|NSC|國科會)[^0-9]{0,20}(\d{3}-\d{4}-[A-Z]-\d{3}-\d{3}(?:-MY\d)?)/gi,
    ],
    priority: 70,
    category: "asia",
  },

  // ═══════════════════════════════════════════════════════════════
  //                       International
  // ═══════════════════════════════════════════════════════════════
  {
    id: "CERN",
    name: "European Organization for Nuclear Research",
    aliases: ["CERN", "欧洲核子研究中心"],
    patterns: [
      // Only identify organization name with context
      /(?:supported|funded|acknowledge).{0,50}(?:CERN)/gi,
      /(?:CERN).{0,50}(?:grant|support)/gi,
    ],
    priority: 80,
    category: "intl",
    hasGrantNumber: false,
  },
  {
    id: "NSFC-CERN",
    name: "NSFC-CERN Joint Research Program",
    aliases: ["NSFC-CERN", "基金委-CERN联合"],
    patterns: [/(?:NSFC-CERN|基金委.*CERN)[^0-9]{0,30}([1-9U]\d{7})/gi],
    priority: 95,
    category: "intl",
  },

  // ═══════════════════════════════════════════════════════════════
  //               HEP Labs & Research Institutes
  // ═══════════════════════════════════════════════════════════════
  {
    id: "Fermilab",
    name: "Fermi National Accelerator Laboratory",
    aliases: [
      "Fermilab",
      "FNAL",
      "Fermi National Laboratory",
      "费米国家加速器实验室",
    ],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:Fermilab|FNAL)/gi,
      /(?:Fermilab|FNAL).{0,50}(?:grant|support|contract)/gi,
    ],
    priority: 75,
    category: "us",
    hasGrantNumber: false,
  },
  {
    id: "SLAC",
    name: "SLAC National Accelerator Laboratory",
    aliases: [
      "SLAC",
      "Stanford Linear Accelerator Center",
      "斯坦福直线加速器中心",
    ],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:SLAC)/gi,
      /(?:SLAC).{0,50}(?:grant|support|contract)/gi,
    ],
    priority: 75,
    category: "us",
    hasGrantNumber: false,
  },
  {
    id: "BNL",
    name: "Brookhaven National Laboratory",
    aliases: ["BNL", "Brookhaven", "布鲁克海文国家实验室"],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:Brookhaven|BNL)/gi,
      /(?:Brookhaven|BNL).{0,50}(?:grant|support|contract)/gi,
    ],
    priority: 75,
    category: "us",
    hasGrantNumber: false,
  },
  {
    id: "RIKEN",
    name: "RIKEN - The Institute of Physical and Chemical Research",
    aliases: ["RIKEN", "理化学研究所", "理研"],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:RIKEN)/gi,
      /(?:RIKEN).{0,50}(?:grant|support)/gi,
    ],
    priority: 75,
    category: "asia",
    hasGrantNumber: false,
  },
  {
    id: "MPG",
    name: "Max Planck Society",
    aliases: [
      "Max Planck",
      "Max-Planck",
      "MPG",
      "Max-Planck-Gesellschaft",
      "马普学会",
      "马克斯·普朗克学会",
    ],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:Max[- ]?Planck|MPG)/gi,
      /(?:Max[- ]?Planck|MPG).{0,50}(?:grant|support)/gi,
    ],
    priority: 75,
    category: "eu",
    hasGrantNumber: false,
  },
  {
    id: "IN2P3",
    name: "Institut National de Physique Nucléaire et de Physique des Particules",
    aliases: ["IN2P3", "CNRS-IN2P3", "法国国家核物理与粒子物理研究所"],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:IN2P3|CNRS)/gi,
      /(?:IN2P3|CNRS).{0,50}(?:grant|support)/gi,
    ],
    priority: 75,
    category: "eu",
    hasGrantNumber: false,
  },
  {
    id: "TRIUMF",
    name: "TRIUMF - Canada's National Laboratory for Particle and Nuclear Physics",
    aliases: ["TRIUMF", "加拿大国家粒子与核物理实验室"],
    patterns: [
      /(?:supported|funded|acknowledge).{0,50}(?:TRIUMF)/gi,
      /(?:TRIUMF).{0,50}(?:grant|support)/gi,
    ],
    priority: 75,
    category: "intl",
    hasGrantNumber: false,
  },
  {
    id: "NSERC",
    name: "Natural Sciences and Engineering Research Council of Canada",
    aliases: ["NSERC", "加拿大自然科学与工程研究理事会"],
    patterns: [
      /(?:NSERC|Natural\s+Sciences\s+and\s+Engineering\s+Research\s+Council)[^0-9]{0,30}(?:Grant\s*(?:No\.?)?\s*)?(\d{6})/gi,
    ],
    priority: 75,
    category: "intl",
  },
  {
    id: "ARC-AU",
    name: "Australian Research Council",
    aliases: ["ARC", "Australian Research Council", "澳大利亚研究理事会"],
    patterns: [
      /(?:ARC|Australian\s+Research\s+Council)[^0-9]{0,30}(?:Grant\s*(?:No\.?)?\s*)?((?:DP|FT|FL|DE|LP|LE)\d{6,9})/gi,
    ],
    priority: 75,
    category: "intl",
  },
  {
    id: "RFBR",
    name: "Russian Foundation for Basic Research",
    aliases: ["RFBR", "РФФИ", "Russian Foundation for Basic Research"],
    patterns: [
      /(?:RFBR|Russian\s+Foundation\s+for\s+Basic\s+Research)[^0-9]{0,30}(?:Grant\s*(?:No\.?)?\s*)?(\d{2}-\d{2}-\d{5})/gi,
    ],
    priority: 70,
    category: "intl",
  },
  {
    id: "RSF",
    name: "Russian Science Foundation",
    aliases: ["RSF", "РНФ", "Russian Science Foundation"],
    patterns: [
      /(?:RSF|Russian\s+Science\s+Foundation)[^0-9]{0,30}(?:Grant\s*(?:No\.?)?\s*)?(\d{2}-\d{2}-\d{5})/gi,
    ],
    priority: 70,
    category: "intl",
  },
];