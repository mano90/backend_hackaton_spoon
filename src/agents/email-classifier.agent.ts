import { callAgent } from './base.agent';

// 1. Define the exact shape of the data we want back
export interface EmailClassificationResult {
  email_id: string;
  type: string[];
  sentiment: 'positive' | 'neutral' | 'negative';
  urgency: 'high' | 'medium' | 'low';
  action_required: string[];
  entities: {
    invoice_id: string | null;
    amount: number | null;
    currency: string | null;
    due_date: string | null;
  };
  attachment?: {
    type: string | null;
    verified: boolean;
  };
  thread: {
    id: string;
    stage: string;
  };
  risk_flags: string[];
}

// 2. The strict prompt that acts as the "brain" for the LLM
const EMAIL_CLASSIFIER_SYSTEM = `You are an expert Financial AI Agent. Your job is to analyze email exchanges between our company and external stakeholders.
You must extract structured data, classify intent, detect risk, and determine the next actions.

Respond UNIQUELY with a strict JSON object matching this exact schema:
{
  "email_id": "<string>",
  "type": ["<invoice | payment_reminder | kyc | general_inquiry | etc>"],
  "sentiment": "<positive | neutral | negative>",
  "urgency": "<high | medium | low>",
  "action_required": ["<make_payment | require_approval | reply | none>"],
  "entities": {
    "invoice_id": "<string or null>",
    "amount": <number or null>,
    "currency": "<string or null>",
    "due_date": "<YYYY-MM-DD or null>"
  },
  "attachment": {
    "type": "<string or null>",
    "verified": <boolean>
  },
  "thread": {
    "id": "<string>",
    "stage": "<string>"
  },
  "risk_flags": ["<overdue_payment | suspicious_bank_change | phishing | none>"]
}

Guidelines:
- Analyze tone for urgency and sentiment.
- Flag any mention of changed bank details or suspicious links in "risk_flags".
- Always output valid JSON without markdown wrapping.`;

// 3. The function that executes the call
export async function analyzeEmail(rawText: string, emailId: string, threadId: string = "unknown"): Promise<EmailClassificationResult> {
  const userMessage = `Email ID: ${emailId}\nThread ID: ${threadId}\n\nEmail Content:\n${rawText.substring(0, 4000)}`;

  const result = await callAgent(EMAIL_CLASSIFIER_SYSTEM, userMessage);

  try {
    return JSON.parse(result) as EmailClassificationResult;
  } catch (error) {
    console.warn(`[analyzeEmail] JSON parse failed, attempting cleanup for email ${emailId}`);
    return JSON.parse(result.replace(/```json\n?/g, '').replace(/```/g, '').trim()) as EmailClassificationResult;
  }
}
