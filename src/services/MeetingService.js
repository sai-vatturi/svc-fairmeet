/**
 * Meeting Service
 * Manages all meetings and provides meeting operations
 */

import { Meeting } from '../models/Meeting.js';

export class MeetingService {
  constructor() {
    this.meetings = new Map(); // Map<meetingCode, Meeting>
  }

  /**
   * Generate unique 6-digit meeting code
   */
  generateMeetingCode() {
    let code;
    do {
      code = Math.floor(100000 + Math.random() * 900000).toString();
    } while (this.meetings.has(code));
    return code;
  }

  /**
   * Create a new meeting
   */
  createMeeting(hostName, socketId) {
    const hostId = this.generateParticipantId();
    const code = this.generateMeetingCode();
    
    const meeting = new Meeting(code, hostId, hostName);
    meeting.startedAt = new Date();
    meeting.addParticipant(hostId, hostName, socketId, true);
    
    this.meetings.set(code, meeting);
    return { meeting, hostId };
  }

  /**
   * Find existing active meeting by moderator name
   * Returns the meeting if found, null otherwise
   */
  findMeetingByModeratorName(moderatorName) {
    for (const [code, meeting] of this.meetings.entries()) {
      if (!meeting.endedAt) {
        // Find the host participant
        const host = Array.from(meeting.participants.values()).find(p => p.isHost);
        if (host && host.name === moderatorName) {
          return { meeting, code, hostId: host.id };
        }
      }
    }
    return null;
  }

  /**
   * Join an existing meeting
   * @param {string} code - Meeting code
   * @param {string} participantName - Participant name
   * @param {string} socketId - Socket ID
   * @param {string} [existingParticipantId] - Optional: existing participant ID for reconnection
   */
  joinMeeting(code, participantName, socketId, existingParticipantId = null) {
    const meeting = this.meetings.get(code);
    
    if (!meeting) {
      throw new Error('Meeting not found');
    }

    if (meeting.endedAt) {
      throw new Error('Meeting has ended');
    }

    // Check if reconnecting with existing participant ID
    let participantId = existingParticipantId;
    let participant;
    
    if (existingParticipantId) {
      // Try to find existing participant by ID
      participant = meeting.participants.get(existingParticipantId);
      if (participant) {
        // Reconnection: update socket ID and name if changed
        participant.socketId = socketId;
        if (participant.name !== participantName) {
          participant.name = participantName; // Update name in case it changed
        }
        console.log(`Participant ${participantName} reconnected with ID ${existingParticipantId}`);
        return { meeting, participant, participantId: existingParticipantId };
      }
    }

    // If no ID provided or ID not found, try to find by name (for reconnection)
    // Check for both regular participants AND moderators
    if (!existingParticipantId) {
      for (const [pId, p] of meeting.participants.entries()) {
        if (p.name === participantName) {
          // Found existing participant with same name - reconnect them
          // This works for both moderators and regular participants
          participant = p;
          participantId = pId;
          participant.socketId = socketId;
          const role = p.isHost ? 'moderator' : 'participant';
          console.log(`${role.charAt(0).toUpperCase() + role.slice(1)} ${participantName} reconnected by name with ID ${pId}`);
          return { meeting, participant, participantId: pId };
        }
      }
    }

    // New participant
    participantId = this.generateParticipantId();
    participant = meeting.addParticipant(participantId, participantName, socketId, false);
    
    return { meeting, participant, participantId };
  }

  /**
   * Get meeting by code
   */
  getMeeting(code) {
    return this.meetings.get(code);
  }

  /**
   * End a meeting
   * Marks the meeting as ended and schedules cleanup
   */
  endMeeting(code) {
    const meeting = this.meetings.get(code);
    if (meeting) {
      meeting.endMeeting(); // Call the meeting's endMeeting method
      console.log(`Meeting ${code} ended by moderator, will be deleted in 60 seconds`);
      // Cleanup meeting after delay to allow participants to see summary
      setTimeout(() => {
        this.meetings.delete(code);
        console.log(`Meeting ${code} deleted from memory`);
      }, 60000); // Delete after 1 minute
    }
    return meeting;
  }

  /**
   * Generate unique participant ID
   */
  generateParticipantId() {
    return `participant_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update participant socket ID (for reconnection)
   */
  updateParticipantSocket(meetingCode, participantId, newSocketId) {
    const meeting = this.meetings.get(meetingCode);
    if (meeting) {
      const participant = meeting.participants.get(participantId);
      if (participant) {
        participant.socketId = newSocketId;
      }
    }
  }

  /**
   * Get all active meetings (for debugging/admin)
   */
  getAllMeetings() {
    return Array.from(this.meetings.values()).map(m => ({
      code: m.code,
      participantCount: m.participants.size,
      startedAt: m.startedAt,
    }));
  }
}

