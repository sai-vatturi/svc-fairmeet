/**
 * Meeting Model
 * Manages meeting state, participants, and real-time analytics
 */

import { v4 as uuidv4 } from 'uuid';
import {
  analyzeAdvancedFairness,
  calculateFairnessScore,
  detectLongTurn,
  calculateSpeakingPercentage,
} from '../utils/fairnessMetrics.js';

export class Meeting {
  constructor(code, hostId, hostName) {
    this.code = code;
    this.hostId = hostId;
    this.createdAt = new Date();
    this.startedAt = null;
    this.metricsStartedAt = null; // When metrics tracking started
    this.endedAt = null;
    this.participants = new Map(); // Map<participantId, Participant>
    this.queue = []; // Array of participantIds in queue order
    this.analytics = {
      fairnessScore: 100,
      giniCoefficient: 0,
      participationEntropy: 0,
      dominanceIndex: 0,
      recommendations: [],
    };
    this.settings = {
      longTurnThreshold: 60, // seconds
      quietInviteThreshold: 300, // 5 minutes
      fairnessUpdateInterval: 1000, // 1 second
    };
    this.nudges = []; // Array of nudge objects
    this.chatMessages = []; // Lightweight meeting chat history
    this.icebreaker = {
      active: false,
      question: null,
      startedAt: null,
      timer: 120, // 2 minutes default
      responses: [], // Array of {participantName, response, timestamp}
    };
    this.transcript = []; // Array of speaking turns: {participantId, participantName, startTime, endTime, duration, text}
    this.aiSummary = null; // AI-generated summary stored here
  }

  /**
   * Add participant to meeting
   * If participant already exists (reconnection), restore their metrics
   */
  addParticipant(participantId, name, socketId, isHost = false) {
    // Check if participant already exists (reconnection scenario)
    const existingParticipant = this.participants.get(participantId);
    
    if (existingParticipant) {
      // Reconnection: update socket ID but keep existing metrics
      existingParticipant.socketId = socketId;
      existingParticipant.isMuted = existingParticipant.isMuted || false;
      existingParticipant.isVideoOff = existingParticipant.isVideoOff || false;
      existingParticipant.isSpeaking = false; // Reset speaking state on reconnect
      console.log(`Participant ${name} reconnected, preserving metrics`);
      return existingParticipant;
    }

    // New participant
    const participant = {
      id: participantId,
      name,
      socketId,
      isHost,
      joinedAt: new Date(),
      speakingTime: 0,
      continuousSpeakingTime: 0,
      lastSpokeAt: null,
      isSpeaking: false,
      isMuted: false,
      isVideoOff: false,
      inQueue: false,
      queuePosition: null,
      handRaisedAt: null,
      turnCount: 0,
      avatar: this.generateAvatar(name),
    };

    this.participants.set(participantId, participant);
    return participant;
  }

  /**
   * Remove participant from meeting
   */
  removeParticipant(participantId) {
    // Remove from queue if present
    this.queue = this.queue.filter(id => id !== participantId);
    this.updateQueuePositions();
    
    // Remove participant
    this.participants.delete(participantId);
    
    // If host left, assign new host (first participant)
    if (this.hostId === participantId && this.participants.size > 0) {
      const firstParticipant = Array.from(this.participants.values())[0];
      firstParticipant.isHost = true;
      this.hostId = firstParticipant.id;
    }
  }

  /**
   * Update participant speaking status
   * Only tracks speaking time if metrics have been started
   */
  updateSpeakingStatus(participantId, isSpeaking) {
    const participant = this.participants.get(participantId);
    if (!participant) return;

    const now = Date.now();
    
    if (isSpeaking && !participant.isSpeaking) {
      // Started speaking
      participant.isSpeaking = true;
      participant.lastSpokeAt = now;
      participant.continuousSpeakingTime = 0;
      if (this.metricsStartedAt) {
        participant.turnCount++;
      }
    } else if (!isSpeaking && participant.isSpeaking) {
      // Stopped speaking - add the time they were speaking
      if (this.metricsStartedAt && participant.lastSpokeAt) {
        const elapsed = (now - participant.lastSpokeAt) / 1000;
        participant.speakingTime += elapsed;
        participant.continuousSpeakingTime += elapsed;
        
        // Add to transcript
        this.transcript.push({
          participantId: participant.id,
          participantName: participant.name,
          startTime: new Date(participant.lastSpokeAt),
          endTime: new Date(now),
          duration: elapsed,
        });
      }
      participant.isSpeaking = false;
      participant.continuousSpeakingTime = 0;
    }
    // Note: Continuous speaking time updates are handled by the periodic interval in server.js
  }

  /**
   * Add speech text to the most recent transcript entry for a participant
   * Creates a new entry if participant is currently speaking and no entry exists
   * @param {string} participantId - ID of the participant
   * @param {string} text - The transcribed text
   */
  addTranscriptText(participantId, text) {
    const participant = this.participants.get(participantId);
    if (!participant) {
      console.warn(`[Transcript] Participant ${participantId} not found`);
      return;
    }

    // Find the most recent transcript entry for this participant
    let foundEntry = null;
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      if (this.transcript[i].participantId === participantId) {
        foundEntry = this.transcript[i];
        break;
      }
    }
    
    if (foundEntry) {
      // Append text to existing transcript entry
      if (foundEntry.text) {
        foundEntry.text += ' ' + text;
      } else {
        foundEntry.text = text;
      }
      // Update end time if participant is still speaking
      if (participant.isSpeaking) {
        foundEntry.endTime = new Date();
        foundEntry.duration = (foundEntry.endTime - foundEntry.startTime) / 1000;
      }
      console.log(`[Transcript] Added text for ${participant.name}: "${text}" (entry exists)`);
    } else {
      // No entry found - create a new one
      // If participant is speaking, use their lastSpokeAt time, otherwise use now
      const startTime = participant.isSpeaking && participant.lastSpokeAt 
        ? new Date(participant.lastSpokeAt)
        : new Date();
      
      const newEntry = {
        participantId: participant.id,
        participantName: participant.name,
        startTime: startTime,
        endTime: new Date(),
        duration: 0,
        text: text,
      };
      
      this.transcript.push(newEntry);
      console.log(`[Transcript] Created new entry for ${participant.name}: "${text}"`);
    }
  }

  /**
   * Record a chat message for this meeting
   */
  addChatMessage(participantId, message) {
    const participant = this.participants.get(participantId);
    if (!participant || !message || !message.trim()) {
      return null;
    }

    const chatMessage = {
      id: uuidv4(),
      participantId,
      participantName: participant.name,
      message: message.trim(),
      timestamp: Date.now(),
      isHost: participant.isHost,
    };

    this.chatMessages.push(chatMessage);
    if (this.chatMessages.length > 200) {
      this.chatMessages.shift();
    }

    return chatMessage;
  }

  /**
   * Get recent chat messages
   */
  getChatMessages(limit = 75) {
    if (!limit || limit <= 0 || this.chatMessages.length <= limit) {
      return [...this.chatMessages];
    }
    return this.chatMessages.slice(-limit);
  }

  /**
   * Add participant to queue
   */
  addToQueue(participantId) {
    const participant = this.participants.get(participantId);
    if (!participant || participant.inQueue) return false;

    participant.inQueue = true;
    participant.handRaisedAt = new Date();
    this.queue.push(participantId);
    this.updateQueuePositions();
    return true;
  }

  /**
   * Remove participant from queue
   */
  removeFromQueue(participantId) {
    const participant = this.participants.get(participantId);
    if (!participant) return false;

    participant.inQueue = false;
    participant.handRaisedAt = null;
    this.queue = this.queue.filter(id => id !== participantId);
    this.updateQueuePositions();
    return true;
  }

  /**
   * Reorder queue
   */
  reorderQueue(newOrder) {
    // Validate all IDs exist
    const validOrder = newOrder.filter(id => this.participants.has(id));
    if (validOrder.length !== this.queue.length) return false;

    this.queue = validOrder;
    this.updateQueuePositions();
    return true;
  }

  /**
   * Update queue positions
   */
  updateQueuePositions() {
    this.queue.forEach((participantId, index) => {
      const participant = this.participants.get(participantId);
      if (participant) {
        participant.queuePosition = index + 1;
      }
    });
  }

  /**
   * Approve next speaker
   */
  approveNextSpeaker() {
    if (this.queue.length === 0) return null;
    return this.queue[0];
  }

  /**
   * Send nudge to participant
   */
  sendNudge(fromParticipantId, toParticipantId, message, template) {
    const nudge = {
      id: uuidv4(),
      fromParticipantId,
      toParticipantId,
      message,
      template,
      sentAt: new Date(),
      read: false,
    };

    this.nudges.push(nudge);
    return nudge;
  }

  /**
   * Start metrics tracking
   */
  startMetrics() {
    if (!this.metricsStartedAt) {
      this.metricsStartedAt = new Date();
      console.log(`Metrics started for meeting ${this.code} at ${this.metricsStartedAt}`);
      return true;
    }
    return false; // Already started
  }

  /**
   * Calculate and update fairness metrics
   * Only calculates if metrics have been started
   * CRITICAL: Excludes host from fairness calculations as per research paper requirements
   */
  calculateFairnessMetrics() {
    // If metrics haven't started, return default values
    if (!this.metricsStartedAt) {
      this.analytics = {
        fairnessScore: 100,
        giniCoefficient: 0,
        participationEntropy: 0,
        dominanceIndex: 0,
        recommendations: ['Metrics tracking not started yet'],
      };
      return;
    }

    // Get non-host participants' speaking times (as per research requirements)
    const nonHostParticipants = Array.from(this.participants.values())
      .filter(p => !p.isHost);
    
    // Handle edge case: no non-host participants
    if (nonHostParticipants.length === 0) {
      this.analytics = {
        fairnessScore: 100,
        giniCoefficient: 0,
        participationEntropy: 0,
        dominanceIndex: 0,
        recommendations: ['No participants to analyze yet'],
      };
      return;
    }

    const speakingTimes = nonHostParticipants.map(p => p.speakingTime);
    const meetingDuration = (Date.now() - this.metricsStartedAt) / 1000;

    // Use research-grade fairness analysis
    const analysis = analyzeAdvancedFairness(speakingTimes, meetingDuration);
    
    this.analytics = {
      ...this.analytics,
      ...analysis,
      fairnessScore: Math.round(analysis.fairnessScore * 100), // Convert to percentage (0-100)
    };
  }

  /**
   * Get participants array (for API responses)
   */
  getParticipantsArray() {
    // Calculate total time based on metrics start time
    const baseTime = this.metricsStartedAt ? this.metricsStartedAt : (this.startedAt || this.createdAt);
    
    return Array.from(this.participants.values()).map(p => ({
      id: p.id,
      name: p.name,
      speakingTime: Math.round(p.speakingTime),
      totalTime: this.metricsStartedAt 
        ? Math.round((Date.now() - this.metricsStartedAt) / 1000)
        : 0,
      isActive: true,
      isSpeaking: p.isSpeaking,
      inQueue: p.inQueue,
      avatar: p.avatar,
      isHost: p.isHost,
      turnCount: p.turnCount,
      continuousSpeakingTime: Math.round(p.continuousSpeakingTime),
      isMuted: p.isMuted || false,
      isVideoOff: p.isVideoOff || false,
    }));
  }

  /**
   * Get meeting summary
   */
  getSummary() {
    this.calculateFairnessMetrics();
    const participants = this.getParticipantsArray();
    const totalDuration = Math.round((Date.now() - (this.startedAt || this.createdAt)) / 1000);

    return {
      meetingCode: this.code,
      duration: totalDuration,
      participants,
      fairnessScore: this.analytics.fairnessScore,
      analytics: this.analytics,
      queueSize: this.queue.length,
      totalNudges: this.nudges.length,
    };
  }

  /**
   * Generate avatar initials
   */
  generateAvatar(name) {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  /**
   * Check for long turns and return participants who should be nudged
   */
  checkLongTurns() {
    const longTurnParticipants = [];
    
    for (const participant of this.participants.values()) {
      if (participant.isHost) continue; // Don't nudge host
      
      const longTurn = detectLongTurn(
        participant.continuousSpeakingTime,
        this.settings.longTurnThreshold
      );
      
      if (longTurn.shouldNudge) {
        longTurnParticipants.push({
          participantId: participant.id,
          participantName: participant.name,
          duration: longTurn.duration,
        });
      }
    }
    
    return longTurnParticipants;
  }

  /**
   * Check for quiet participants (haven't spoken in threshold time)
   */
  checkQuietParticipants() {
    const quietParticipants = [];
    const now = Date.now();
    const threshold = this.settings.quietInviteThreshold * 1000; // Convert to ms
    
    for (const participant of this.participants.values()) {
      if (participant.isHost || participant.isSpeaking) continue;
      
      const timeSinceLastSpoke = participant.lastSpokeAt
        ? now - participant.lastSpokeAt
        : now - participant.joinedAt;
      
      if (timeSinceLastSpoke > threshold) {
        quietParticipants.push({
          participantId: participant.id,
          participantName: participant.name,
          silenceDuration: Math.round(timeSinceLastSpoke / 1000),
        });
      }
    }
    
    return quietParticipants;
  }

  /**
   * End the meeting
   */
  endMeeting() {
    if (!this.endedAt) {
      this.endedAt = new Date();
      console.log(`Meeting ${this.code} ended at ${this.endedAt}`);
    }
  }

  /**
   * Start an icebreaker with the given question
   */
  startIcebreaker(question, duration = 120) {
    this.icebreaker = {
      active: true,
      question,
      startedAt: Date.now(),
      timer: duration,
      responses: [],
    };
    console.log(`Icebreaker started for meeting ${this.code}: "${question}"`);
  }

  /**
   * Record a participant's response to the icebreaker
   */
  recordIcebreakerResponse(participantName, responseText) {
    if (this.icebreaker.active) {
      // Check if participant already responded
      const existingIndex = this.icebreaker.responses.findIndex(r => r.participantName === participantName);
      
      if (existingIndex >= 0) {
        // Update existing response
        this.icebreaker.responses[existingIndex] = {
          participantName,
          response: responseText,
          timestamp: Date.now(),
        };
      } else {
        // Add new response
        this.icebreaker.responses.push({
          participantName,
          response: responseText,
          timestamp: Date.now(),
        });
      }
      console.log(`${participantName} responded to icebreaker in meeting ${this.code}: "${responseText}"`);
    }
  }

  /**
   * End the icebreaker
   */
  endIcebreaker() {
    if (this.icebreaker.active) {
      this.icebreaker.active = false;
      console.log(`Icebreaker ended for meeting ${this.code}. ${this.icebreaker.responses.length} participants responded.`);
    }
  }

  /**
   * Get icebreaker data
   */
  getIcebreakerData() {
    return {
      active: this.icebreaker.active,
      question: this.icebreaker.question,
      timer: this.icebreaker.active 
        ? Math.max(0, this.icebreaker.timer - Math.floor((Date.now() - this.icebreaker.startedAt) / 1000))
        : 0,
      responses: this.icebreaker.responses,
      totalParticipants: this.participants.size,
      respondedCount: this.icebreaker.responses.length,
    };
  }
}


