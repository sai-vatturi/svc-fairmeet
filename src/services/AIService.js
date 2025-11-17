/**
 * AI Service using Google Gemini API
 * Handles icebreaker generation, meeting summaries, and topic suggestions
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

export class AIService {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set in environment variables');
    }
    
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Use gemini-1.5-flash as primary (more stable availability)
    // Fallback to gemini-2.0-flash if needed
    this.primaryModelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    this.fallbackModelName = 'gemini-2.0-flash';
    this.model = this.genAI.getGenerativeModel({ model: this.primaryModelName });
    console.log(`[AIService] Using Gemini model: ${this.primaryModelName}`);
  }

  async generateText(prompt) {
    try {
      const result = await this.model.generateContent(prompt);
      const text = result.response.text().trim();
      return text;
    } catch (err) {
      // If model not found (e.g., using 1.5 on v1beta), attempt fallback model once
      const is404 = err && (err.status === 404 || /not found/i.test(err?.statusText || '') || /404/i.test(String(err)));
      if (is404 && this.primaryModelName !== this.fallbackModelName) {
        console.warn(`[AIService] Model ${this.primaryModelName} not available. Falling back to ${this.fallbackModelName}`);
        this.model = this.genAI.getGenerativeModel({ model: this.fallbackModelName });
        const retry = await this.model.generateContent(prompt);
        return retry.response.text().trim();
      }
      throw err;
    }
  }

  /**
   * Clean up AI response by removing preambles and explanations
   */
  cleanResponse(text) {
    // Remove common preambles
    let cleaned = text
      .replace(/^Here's (one|a single|an engaging).*?:\s*/i, '')
      .replace(/^Here are.*?:\s*/i, '')
      .replace(/^\*\*.*?\*\*\s*/g, '')  // Remove markdown bold
      .replace(/^["']|["']$/g, '');      // Remove quotes
    
    // Extract just the question if there's explanatory text after
    const lines = cleaned.split('\n').filter(line => line.trim());
    
    // Find the first line that looks like a question or is substantial
    for (const line of lines) {
      const trimmed = line.trim().replace(/^[-*]\s*/, ''); // Remove bullet points
      if (trimmed && (trimmed.includes('?') || trimmed.length > 20)) {
        return trimmed;
      }
    }
    
    // Fallback: return first non-empty line
    return lines[0]?.trim() || cleaned;
  }

  /**
   * Generate an icebreaker question for the meeting
   * @param {string} meetingContext - Optional context about the meeting type/topic
   * @returns {Promise<string>} The icebreaker question
   */
  async generateIcebreaker(meetingContext = 'professional team meeting') {
    try {
      // Add timestamp and random element to ensure variety
      const randomSeed = Math.floor(Math.random() * 1000000);
      const timestamp = Date.now();
      const prompt = `Generate ONE short, engaging icebreaker question for a ${meetingContext}.

IMPORTANT: Generate a DIFFERENT question each time. This is request #${randomSeed} at time ${timestamp}.

Requirements:
- Must be a single question (1-2 lines maximum)
- Fun but professional
- Quick to answer (30 seconds or less)
- Open-ended but not too personal
- NO explanations, NO preambles, NO context - ONLY the question
- MUST be creative and varied - avoid repeating common questions

Examples of DIFFERENT styles to vary:
"If you could have any superpower for one day, what would it be?"
"What's the most interesting thing you've learned this week?"
"If you could meet any historical figure, who would it be?"
"What's a skill you'd love to master and why?"
"What's your favorite way to celebrate small wins?"
"If you could instantly become an expert in something, what would it be?"

Generate a NEW, UNIQUE question now (different from examples). Return ONLY the question, nothing else.`;

      const text = await this.generateText(prompt);
      const cleaned = this.cleanResponse(text);
      
      // Ensure it's not too long (max ~150 chars for UI)
      if (cleaned.length > 150) {
        const sentences = cleaned.split(/[.!?]/).filter(s => s.trim());
        return sentences[0].trim() + '?';
      }
      
      return cleaned;
    } catch (error) {
      console.error('Error generating icebreaker:', error);
      // Fallback icebreakers if API fails
      const fallbacks = [
        "What's one thing you're looking forward to this week?",
        "If you could learn any new skill instantly, what would it be?",
        "What's the best piece of advice you've ever received?",
        "What's your favorite way to unwind after work?",
        "If you could travel anywhere right now, where would you go?"
      ];
      return fallbacks[Math.floor(Math.random() * fallbacks.length)];
    }
  }

  /**
   * Generate meeting summary from transcript
   * @param {Object} meetingData - Meeting data including participants and speaking times
   * @returns {Promise<Object>} Meeting summary
   */
  async generateMeetingSummary(meetingData) {
    try {
      const { participants, duration, analytics, transcript = [] } = meetingData;
      
      console.log('[AIService] Generating summary with:', {
        participantCount: participants.length,
        duration: duration,
        transcriptEntries: transcript.length,
        transcriptWithText: transcript.filter(e => e.text && e.text.trim().length > 0).length,
      });
      
      // Build conversation context from transcript with token limit awareness
      let conversationText = '';
      const transcriptWithText = transcript.filter(entry => entry.text && entry.text.trim().length > 0);
      
      if (transcriptWithText && transcriptWithText.length > 0) {
        // Format transcript entries
        const formattedTranscript = transcriptWithText.map(entry => {
          const time = entry.startTime ? new Date(entry.startTime).toLocaleTimeString() : 'Unknown time';
          return `[${time}] ${entry.participantName}: ${entry.text}`;
        }).join('\n');
        
        // Truncate if needed to fit within token limits (70% of 1M = 700k tokens)
        const fullText = '\n\nConversation Transcript:\n' + formattedTranscript;
        const estimatedTokens = this.estimateTokens(fullText);
        
        if (estimatedTokens > 700000) {
          console.warn(`[AIService] Transcript too large (${estimatedTokens} tokens), truncating to fit 70% limit`);
          // Truncate transcript entries to fit
          let truncated = '';
          let currentTokens = this.estimateTokens('\n\nConversation Transcript:\n');
          
          for (let i = transcriptWithText.length - 1; i >= 0; i--) {
            const entry = transcriptWithText[i];
            const entryText = `[${new Date(entry.startTime).toLocaleTimeString()}] ${entry.participantName}: ${entry.text}\n`;
            const entryTokens = this.estimateTokens(entryText);
            
            if (currentTokens + entryTokens > 700000) break;
            
            truncated = entryText + truncated;
            currentTokens += entryTokens;
          }
          
          conversationText = '\n\nConversation Transcript:\n' + truncated;
        } else {
          conversationText = fullText;
        }
      } else {
        console.warn('[AIService] No transcript entries with text found');
        conversationText = '\n\nNote: No conversation transcript was captured during this meeting.';
      }
      
      // Always generate summary with two sections: Discussion and Fairness
      const hasTranscript = transcriptWithText && transcriptWithText.length > 0;
      
      let prompt;
      if (hasTranscript) {
        // If we have transcript, use it for discussion section
        prompt = `Generate a meeting summary with EXACTLY two sections as specified below.

${conversationText}

Meeting Context:
- Duration: ${Math.floor(duration / 60)} minutes
- Participants: ${participants.map(p => p.name).join(', ')}

Generate a professional meeting summary with the following EXACT structure:

**1. Meeting Discussion Summary**
Based on the conversation transcript above, provide a detailed summary of what was actually discussed. Include:
- Key topics and points discussed
- What each participant contributed
- Questions raised and answers provided
- Decisions made or action items discussed
- Flow of the conversation

Reference specific things participants said from the transcript. This section should be comprehensive and based on the actual conversation content.

**2. Meeting Fairness Summary**
Provide a concise 3-4 line summary of participation fairness:
- Speaking time distribution: ${participants.map(p => `${p.name} (${Math.floor(p.speakingTime / 60)}m ${Math.floor(p.speakingTime % 60)}s)`).join(', ')}
- Fairness Score: ${analytics.fairnessScore}/100
- Brief assessment of participation balance and engagement levels

Keep the fairness section brief (3-4 lines maximum).`;
      } else {
        // If no transcript, still provide both sections
        prompt = `Generate a meeting summary with EXACTLY two sections as specified below.

Meeting Context:
- Duration: ${Math.floor(duration / 60)} minutes
- Participants: ${participants.map(p => p.name).join(', ')}

Note: No conversation transcript was captured during this meeting.

Generate a professional meeting summary with the following EXACT structure:

**1. Meeting Discussion Summary**
State clearly: "No speech has been recorded during this meeting. No conversation transcript is available to summarize the discussion."

**2. Meeting Fairness Summary**
Provide a concise 3-4 line summary of participation fairness:
- Speaking time distribution: ${participants.map(p => `${p.name} (${Math.floor(p.speakingTime / 60)}m ${Math.floor(p.speakingTime % 60)}s)`).join(', ')}
- Fairness Score: ${analytics.fairnessScore}/100
- Brief assessment of participation balance and engagement levels

Keep the fairness section brief (3-4 lines maximum).`;
      }

      const text = await this.generateText(prompt);
      
      return {
        summary: text,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      console.error('Error generating summary:', error);
      return {
        summary: 'Unable to generate AI summary at this time.',
        generatedAt: new Date().toISOString(),
        error: error.message,
      };
    }
  }

  /**
   * Estimate token count (rough approximation: ~4 characters per token)
   */
  estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Truncate transcript to fit within token limit (70% of max)
   * Gemini 2.5 Flash supports 1M tokens, so 70% = 700k tokens
   */
  truncateTranscript(transcript, maxTokens = 700000) {
    if (!transcript || transcript.length === 0) return '';
    
    let truncated = '';
    let currentTokens = 0;
    
    // Start from the end (most recent) and work backwards
    for (let i = transcript.length - 1; i >= 0; i--) {
      const entry = transcript[i];
      if (!entry.text || entry.text.trim().length === 0) continue;
      
      const entryText = `[${entry.participantName}]: ${entry.text}\n`;
      const entryTokens = this.estimateTokens(entryText);
      
      if (currentTokens + entryTokens > maxTokens) break;
      
      truncated = entryText + truncated;
      currentTokens += entryTokens;
    }
    
    return truncated;
  }

  /**
   * Generate topic suggestions based on meeting context
   * @param {Object} context - Current meeting context including transcript
   * @returns {Promise<Array>} Array of 3 topic suggestions
   */
  async generateTopicSuggestions(context) {
    try {
      const { participants = [], duration = 0, transcript = [] } = context;
      
      // Truncate transcript to fit within token limits
      const truncatedTranscript = this.truncateTranscript(transcript);
      const hasTranscript = truncatedTranscript.length > 0;
      
      // Build prompt with token limit awareness
      let prompt;
      if (hasTranscript) {
        // If transcript exists, generate ideas that extend the conversation
        prompt = `Based on the following meeting conversation, generate EXACTLY 3 ideas for what to speak next that would naturally extend or build upon the current discussion.

Recent Conversation:
${truncatedTranscript}

Participants: ${participants.map(p => p.name).join(', ')}
Meeting Duration: ${Math.floor(duration / 60)} minutes

Generate 3 specific, actionable ideas that:
1. Build on topics already discussed
2. Add value to the current conversation
3. Encourage further engagement

Return ONLY a JSON array with this exact format (no markdown, no explanations):
[
  {"title": "Idea 1 title", "description": "Brief description"},
  {"title": "Idea 2 title", "description": "Brief description"},
  {"title": "Idea 3 title", "description": "Brief description"}
]`;
      } else {
        // If no transcript, generate random relevant topics
        prompt = `Generate EXACTLY 3 engaging discussion topics for a professional meeting.

Participants: ${participants.map(p => p.name).join(', ')}
Meeting Duration: ${Math.floor(duration / 60)} minutes

Generate 3 diverse, interesting topics that could:
1. Break the ice and get the conversation started
2. Encourage participation from all attendees
3. Be relevant to a professional team meeting

Return ONLY a JSON array with this exact format (no markdown, no explanations):
[
  {"title": "Topic 1 title", "description": "Brief description"},
  {"title": "Topic 2 title", "description": "Brief description"},
  {"title": "Topic 3 title", "description": "Brief description"}
]`;
      }

      // Check token count before sending
      const promptTokens = this.estimateTokens(prompt);
      if (promptTokens > 700000) {
        console.warn(`[AIService] Prompt too large (${promptTokens} tokens), truncating further`);
        // Further truncate if needed
        const furtherTruncated = this.truncateTranscript(transcript, 500000);
        prompt = prompt.replace(truncatedTranscript, furtherTruncated);
      }

      const text = await this.generateText(prompt);
      
      // Try to parse JSON response
      try {
        // Extract JSON if wrapped in markdown code blocks
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          // Ensure we have exactly 3 items
          return parsed.slice(0, 3);
        }
        const parsed = JSON.parse(text);
        return parsed.slice(0, 3);
      } catch (parseError) {
        console.error('Error parsing AI response:', parseError);
        // Return fallback topics
        return hasTranscript ? [
          { title: "Ask a clarifying question", description: "Seek more details about a point that was just discussed" },
          { title: "Share a related experience", description: "Contribute a similar situation or example that adds context" },
          { title: "Propose next steps", description: "Suggest actionable follow-up items based on the discussion" }
        ] : [
          { title: "Project Updates", description: "Share recent progress and upcoming milestones" },
          { title: "Team Collaboration", description: "Discuss ways to improve team coordination" },
          { title: "Open Q&A", description: "Address any questions or concerns from the team" }
        ];
      }
    } catch (error) {
      console.error('Error generating topics:', error);
      return [
        { title: "Open Discussion", description: "Share updates and discuss any pressing matters" },
        { title: "Team Feedback", description: "Gather input from team members on recent developments" },
        { title: "Next Steps", description: "Plan action items and next steps for the team" }
      ];
    }
  }

  /**
   * Generate key insights for meeting summary
   * @param {Object} meetingData - Meeting data including participants, duration, fairness score, transcript
   * @returns {Promise<Array>} Array of 3 key insights with colors
   */
  async generateKeyInsights(meetingData) {
    try {
      const { participants = [], duration = 0, fairnessScore = 0, transcript = [] } = meetingData;
      
      // Truncate transcript to fit within token limits
      const truncatedTranscript = this.truncateTranscript(transcript);
      const hasTranscript = truncatedTranscript.length > 0;
      
      let prompt;
      if (hasTranscript) {
        prompt = `Based on the following meeting data, generate EXACTLY 3 key insights about the meeting.

Recent Conversation:
${truncatedTranscript}

Meeting Statistics:
- Duration: ${Math.floor(duration / 60)} minutes
- Participants: ${participants.map(p => `${p.name} (${Math.floor(p.speakingTime / 60)}m ${Math.floor(p.speakingTime % 60)}s)`).join(', ')}
- Fairness Score: ${fairnessScore}/100

Generate 3 diverse, actionable insights:
1. One about PARTICIPATION/BALANCE (use green color)
2. One about DISCUSSION QUALITY/CONTENT (use blue color)
3. One about PROCESS/COLLABORATION (use purple color)

Each insight should be:
- Specific to THIS meeting
- Positive or constructive (not negative)
- Actionable or educational
- 1-2 sentences maximum

Return ONLY a JSON array with this exact format (no markdown, no explanations):
[
  {"text": "First insight about participation", "color": "green"},
  {"text": "Second insight about discussion quality", "color": "blue"},
  {"text": "Third insight about process", "color": "purple"}
]`;
      } else {
        // If no transcript, use only statistics
        prompt = `Based on the following meeting statistics, generate EXACTLY 3 key insights about the meeting.

Meeting Statistics:
- Duration: ${Math.floor(duration / 60)} minutes
- Participants: ${participants.map(p => `${p.name} (${Math.floor(p.speakingTime / 60)}m ${Math.floor(p.speakingTime % 60)}s)`).join(', ')}
- Fairness Score: ${fairnessScore}/100

Note: No conversation transcript was recorded during this meeting.

Generate 3 diverse, actionable insights:
1. One about PARTICIPATION/BALANCE (use green color)
2. One about MEETING METRICS (use blue color)
3. One about IMPROVEMENT OPPORTUNITIES (use purple color)

Each insight should be:
- Based on the statistics provided
- Positive or constructive (not negative)
- Actionable or educational
- 1-2 sentences maximum

Return ONLY a JSON array with this exact format (no markdown, no explanations):
[
  {"text": "First insight about participation", "color": "green"},
  {"text": "Second insight about metrics", "color": "blue"},
  {"text": "Third insight about improvements", "color": "purple"}
]`;
      }

      const text = await this.generateText(prompt);
      
      // Try to parse JSON response
      try {
        // Extract JSON if wrapped in markdown code blocks
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          // Ensure we have exactly 3 items with text and color
          return parsed.slice(0, 3).map(item => ({
            text: item.text || "Meeting insight unavailable",
            color: item.color || "blue"
          }));
        }
        const parsed = JSON.parse(text);
        return parsed.slice(0, 3).map(item => ({
          text: item.text || "Meeting insight unavailable",
          color: item.color || "blue"
        }));
      } catch (parseError) {
        console.error('Error parsing AI insights response:', parseError);
        // Return fallback insights
        return [
          { 
            text: fairnessScore > 80 
              ? "Great participation balance achieved across all attendees." 
              : "Consider encouraging quieter participants to share more.",
            color: "green" 
          },
          { 
            text: hasTranscript 
              ? "All participants contributed to the discussion effectively." 
              : "Enable speech recognition for better meeting insights.",
            color: "blue" 
          },
          { 
            text: "Queue system helped manage turn-taking efficiently.",
            color: "purple" 
          }
        ];
      }
    } catch (error) {
      console.error('Error generating key insights:', error);
      return [
        { text: "Great participation balance achieved.", color: "green" },
        { text: "All participants contributed to the discussion.", color: "blue" },
        { text: "Queue system helped manage turn-taking.", color: "purple" }
      ];
    }
  }
}
