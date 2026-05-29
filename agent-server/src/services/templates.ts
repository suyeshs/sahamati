// Marketing templates — ported from sahamati-video/packages/shared/src/templates.ts

import type { MarketingTemplate } from "../types/video.js";

export const marketingTemplates: MarketingTemplate[] = [
  {
    id: "aa-explainer-basic",
    name: "Account Aggregator Explainer",
    description: "Explain how Account Aggregator works in simple terms",
    category: "aa-explainer",
    promptTemplate: `A professional, modern animated video explaining Account Aggregator technology.
Show a person using their phone to securely share their financial data with a lender.
Visualize data flowing securely with encryption symbols.
The scene should feel trustworthy and futuristic.
Include subtle blue and green colors representing security and growth.
{{customMessage}}`,
    suggestedAspectRatio: "16:9",
    suggestedDuration: 8,
    variables: [
      {
        name: "customMessage",
        label: "Custom Message",
        type: "text",
        required: false,
        placeholder: "Add any specific message or call-to-action",
      },
    ],
  },
  {
    id: "consent-journey",
    name: "Consent Journey",
    description: "Show the user consent flow for data sharing",
    category: "data-empowerment",
    promptTemplate: `A cinematic video showing a person's journey of giving consent for financial data sharing.
Start with the person looking at their phone, then show them reviewing consent options.
Visualize the consent being approved with a satisfying confirmation animation.
End with the person smiling, feeling in control of their data.
Modern, clean UI elements visible on the phone screen.
{{focusArea}}`,
    suggestedAspectRatio: "9:16",
    suggestedDuration: 8,
    variables: [
      {
        name: "focusArea",
        label: "Focus Area",
        type: "select",
        required: true,
        options: ["Loan Application", "Investment Planning", "Insurance", "General"],
        defaultValue: "General",
      },
    ],
  },
  {
    id: "financial-inclusion-story",
    name: "Financial Inclusion Impact",
    description: "Tell the story of financial inclusion through AA",
    category: "financial-inclusion",
    promptTemplate: `An emotional, inspiring video about financial inclusion in India.
Show diverse people from different backgrounds - a small shop owner, a farmer, a young entrepreneur.
Each person is shown accessing financial services easily through their smartphone.
The mood is hopeful and empowering.
Include scenes of {{targetAudience}} getting approved for {{financialProduct}}.
End with a message of financial empowerment for all.`,
    suggestedAspectRatio: "16:9",
    suggestedDuration: 8,
    variables: [
      {
        name: "targetAudience",
        label: "Target Audience",
        type: "select",
        required: true,
        options: ["Small Business Owners", "Farmers", "Young Professionals", "Women Entrepreneurs"],
        defaultValue: "Small Business Owners",
      },
      {
        name: "financialProduct",
        label: "Financial Product",
        type: "select",
        required: true,
        options: ["Business Loans", "Personal Loans", "Insurance", "Investment Plans"],
        defaultValue: "Business Loans",
      },
    ],
  },
  {
    id: "msme-success",
    name: "MSME Success Story",
    description: "Showcase how MSMEs benefit from AA ecosystem",
    category: "msme-success",
    promptTemplate: `A success story video about a small business owner in India.
Show {{businessType}} owner struggling with paperwork for a loan.
Then show them using Account Aggregator to share their financial data instantly.
The loan gets approved quickly, and we see their business growing.
End with the business thriving - more customers, better equipment, happy employees.
Warm, optimistic lighting throughout.`,
    suggestedAspectRatio: "16:9",
    suggestedDuration: 8,
    variables: [
      {
        name: "businessType",
        label: "Business Type",
        type: "text",
        required: true,
        placeholder: "e.g., Restaurant, Textile Shop, Grocery Store",
        defaultValue: "Small Shop",
      },
    ],
  },
  {
    id: "partner-intro",
    name: "Partner Showcase",
    description: "Introduce a Sahamati ecosystem partner",
    category: "partner-showcase",
    promptTemplate: `A professional corporate video introducing {{partnerName}} as part of the Sahamati ecosystem.
Show modern office environment with people collaborating.
Visualize data connections between different financial institutions.
Highlight the partnership benefits: faster processing, better user experience, secure data sharing.
Include the Sahamati branding subtly in the background.
Professional, trustworthy tone with {{colorScheme}} color accents.`,
    suggestedAspectRatio: "16:9",
    suggestedDuration: 6,
    variables: [
      {
        name: "partnerName",
        label: "Partner Name",
        type: "text",
        required: true,
        placeholder: "Enter partner organization name",
      },
      {
        name: "colorScheme",
        label: "Color Scheme",
        type: "select",
        required: false,
        options: ["Blue and White", "Green and Gold", "Purple and Silver"],
        defaultValue: "Blue and White",
      },
    ],
  },
  {
    id: "social-media-reel",
    name: "Social Media Reel",
    description: "Quick, engaging content for social media",
    category: "aa-explainer",
    promptTemplate: `A fast-paced, engaging social media reel about {{topic}}.
Quick cuts, dynamic transitions, bold text overlays.
Modern, trendy aesthetic with vibrant colors.
End with a clear call-to-action.
Optimized for mobile viewing with vertical format.
{{additionalNotes}}`,
    suggestedAspectRatio: "9:16",
    suggestedDuration: 4,
    variables: [
      {
        name: "topic",
        label: "Topic",
        type: "select",
        required: true,
        options: [
          "What is Account Aggregator?",
          "How to share your data safely",
          "Get loans faster with AA",
          "Your data, your control",
        ],
        defaultValue: "What is Account Aggregator?",
      },
      {
        name: "additionalNotes",
        label: "Additional Notes",
        type: "text",
        required: false,
        placeholder: "Any specific style or content notes",
      },
    ],
  },
  // Multi-scene templates
  {
    id: "aa-explainer-30s",
    name: "Account Aggregator Explainer (30s)",
    description: "4-scene video explaining AA ecosystem - perfect for YouTube/LinkedIn",
    category: "multi-scene",
    promptTemplate: "",
    suggestedAspectRatio: "16:9",
    suggestedDuration: 8,
    variables: [],
    isMultiScene: true,
    scenes: [
      {
        prompt: "Cinematic opening shot of a young Indian professional looking frustrated with paperwork and documents for a loan application. Modern office setting, warm lighting, documentary style.",
        duration: 8,
        description: "Scene 1: The Problem - Loan paperwork frustration",
      },
      {
        prompt: "The same person discovers Account Aggregator on their smartphone. Close-up of the phone screen showing a clean, modern consent interface. Expression changes from frustration to curiosity. Soft blue glow from the screen.",
        duration: 8,
        description: "Scene 2: Discovery - Finding AA solution",
      },
      {
        prompt: "Visualization of secure data flowing between banks with encryption symbols and shield icons. Abstract but professional animation style showing multiple financial institutions connected through a central secure hub. Sahamati ecosystem visualization.",
        duration: 8,
        description: "Scene 3: How it Works - Secure data sharing",
      },
      {
        prompt: "Happy ending: the person receives loan approval notification on their phone, smiles with relief. Quick montage of their business growing - new equipment, happy customers. Inspirational, warm color grading.",
        duration: 8,
        description: "Scene 4: Success - Loan approved, business grows",
      },
    ],
  },
  {
    id: "msme-success-story-32s",
    name: "MSME Success Story (32s)",
    description: "4-scene story of small business growth through AA - for social campaigns",
    category: "multi-scene",
    promptTemplate: "",
    suggestedAspectRatio: "16:9",
    suggestedDuration: 8,
    variables: [],
    isMultiScene: true,
    scenes: [
      {
        prompt: "A small Indian kirana shop owner in their modest store, counting cash manually, looking worried about expanding their business. Warm, authentic documentary style. Early morning light.",
        duration: 8,
        description: "Scene 1: The Dream - Small shop owner wants to grow",
      },
      {
        prompt: "Close-up of the shop owner's hands using a smartphone to share their financial data through Account Aggregator. Simple, clean app interface visible. The process looks effortless and modern.",
        duration: 8,
        description: "Scene 2: The Solution - Using AA for instant data sharing",
      },
      {
        prompt: "Bank manager reviewing the digital financial data on a tablet, nodding approvingly. Professional bank interior. The loan approval stamp or digital confirmation appears. Satisfying moment.",
        duration: 8,
        description: "Scene 3: Approval - Bank reviews and approves quickly",
      },
      {
        prompt: "Transformed shop - now bigger, brighter, with more inventory and customers. The same shop owner, now confident and successful, greeting customers. Text overlay space for 'Powered by Account Aggregator'.",
        duration: 8,
        description: "Scene 4: Transformation - Business thriving",
      },
    ],
  },
  {
    id: "data-empowerment-reel-24s",
    name: "Data Empowerment Reel (24s)",
    description: "3-scene vertical video for Instagram/YouTube Shorts",
    category: "multi-scene",
    promptTemplate: "",
    suggestedAspectRatio: "9:16",
    suggestedDuration: 8,
    variables: [],
    isMultiScene: true,
    scenes: [
      {
        prompt: "Bold text animation: 'YOUR DATA. YOUR POWER.' against a dynamic gradient background. Young Indian person confidently holding their smartphone. Trendy, Gen-Z aesthetic with vibrant colors.",
        duration: 8,
        description: "Scene 1: Hook - Bold statement about data ownership",
      },
      {
        prompt: "Fast-paced montage: phone screen showing consent toggle, secure lock icon, data flowing to a bank icon. Modern UI animations. The user is in control, tapping to approve. Energetic, empowering vibe.",
        duration: 8,
        description: "Scene 2: Control - User in control of their data",
      },
      {
        prompt: "Celebration moment: loan approved notification, confetti animation, person doing a small victory gesture. Clean white background with colorful accents. Call-to-action space at bottom.",
        duration: 8,
        description: "Scene 3: Win - Success and call to action",
      },
    ],
  },
  {
    id: "consent-flow-demo-40s",
    name: "Consent Flow Demo (40s)",
    description: "5-scene detailed walkthrough of the consent journey",
    category: "multi-scene",
    promptTemplate: "",
    suggestedAspectRatio: "16:9",
    suggestedDuration: 8,
    variables: [],
    isMultiScene: true,
    scenes: [
      {
        prompt: "Professional Indian woman at her laptop, applying for a business loan on a modern fintech website. Clean, minimal office setup. Screen shows loan application form.",
        duration: 8,
        description: "Scene 1: Application - Starting a loan application",
      },
      {
        prompt: "Phone notification appears: 'Consent request from XYZ Bank'. She picks up the phone. Close-up of the notification with the Account Aggregator logo visible.",
        duration: 8,
        description: "Scene 2: Request - Receiving consent request",
      },
      {
        prompt: "Detailed view of consent screen on phone: showing what data will be shared, for how long, with whom. Her finger hovers over 'Review Details' button. Educational, informative framing.",
        duration: 8,
        description: "Scene 3: Review - Understanding the consent details",
      },
      {
        prompt: "She approves the consent with a confident tap. Satisfying animation of a checkmark and secure data transfer visualization. Green success colors, sense of security and control.",
        duration: 8,
        description: "Scene 4: Approve - Giving informed consent",
      },
      {
        prompt: "Split screen: her relaxing with coffee while the system processes. Then laptop shows 'Loan Pre-Approved!' message. She smiles. Professional, trustworthy atmosphere.",
        duration: 8,
        description: "Scene 5: Result - Fast approval thanks to AA",
      },
    ],
  },
];

export function getTemplateById(id: string): MarketingTemplate | undefined {
  return marketingTemplates.find((t) => t.id === id);
}

export function getTemplatesByCategory(category: string): MarketingTemplate[] {
  return marketingTemplates.filter((t) => t.category === category);
}

export function fillTemplate(
  template: MarketingTemplate,
  variables: Record<string, string | number>
): string {
  let prompt = template.promptTemplate;

  for (const variable of template.variables) {
    const value = variables[variable.name] ?? variable.defaultValue ?? "";
    prompt = prompt.replace(new RegExp(`\\{\\{${variable.name}\\}\\}`, "g"), String(value));
  }

  // Remove any unfilled variables
  prompt = prompt.replace(/\{\{[^}]+\}\}/g, "");

  return prompt.trim();
}
