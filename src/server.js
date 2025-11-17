/**
 * FairMeet Backend Server
 * Research-grade meeting equity system with WebSocket support
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import './utils/setupLogging.js';
import { MeetingService } from './services/MeetingService.js';
import { AIService } from './services/AIService.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

// Initialize services
const meetingService = new MeetingService();
const aiService = new AIService();

// REST API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/meetings/:code/summary', (req, res) => {
  const { code } = req.params;
  const meeting = meetingService.getMeeting(code);
  
  if (!meeting) {
    return res.status(404).json({ error: 'Meeting not found' });
  }

  const summary = meeting.getSummary();
  res.json(summary);
});

// WebSocket Connection Handler
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Check for existing meeting by moderator name
  socket.on('checkExistingMeeting', ({ hostName }) => {
    console.log(`[checkExistingMeeting] Checking for existing meeting by moderator: ${hostName}`);
    const existingMeeting = meetingService.findMeetingByModeratorName(hostName);
    
    if (existingMeeting) {
      console.log(`[checkExistingMeeting] Found existing meeting ${existingMeeting.code} for moderator ${hostName}`);
      socket.emit('existingMeetingFound', {
        meetingCode: existingMeeting.code,
        hostId: existingMeeting.hostId,
        participantCount: existingMeeting.meeting.participants.size,
        startedAt: existingMeeting.meeting.startedAt,
      });
    } else {
      console.log(`[checkExistingMeeting] No existing meeting found for moderator ${hostName}`);
      socket.emit('noExistingMeeting');
    }
  });

  // Create new meeting
  socket.on('createMeeting', ({ hostName }) => {
    try {
      const { meeting, hostId } = meetingService.createMeeting(hostName, socket.id);
      
      socket.join(meeting.code);
      
      // Store socket ID in participant for WebRTC signaling
      const hostParticipant = meeting.participants.get(hostId);
      if (hostParticipant) {
        hostParticipant.socketId = socket.id;
      }
      
      // Calculate initial fairness metrics
      meeting.calculateFairnessMetrics();
      
      socket.emit('meetingCreated', {
        meetingCode: meeting.code,
        hostId,
        participants: meeting.getParticipantsArray(),
      });

      // Send initial meeting state to moderator
      socket.emit('meetingState', {
        participants: meeting.getParticipantsArray(),
        analytics: meeting.analytics,
        queue: [],
        metricsStarted: !!meeting.metricsStartedAt,
        chatMessages: meeting.getChatMessages(),
      });

      console.log(`Meeting created: ${meeting.code} by ${hostName} (${hostId})`);
      console.log(`Participants:`, meeting.getParticipantsArray());
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Join existing meeting
  socket.on('joinMeeting', ({ name, code, participantId: existingParticipantId }) => {
    try {
      const { meeting, participant, participantId } = meetingService.joinMeeting(
        code,
        name,
        socket.id,
        existingParticipantId // Pass existing participant ID for reconnection
      );

      socket.join(code);
      
      // Store socket ID in participant for WebRTC signaling
      participant.socketId = socket.id;
      
      const role = participant.isHost ? 'moderator' : 'participant';
      console.log(`[joinMeeting] ${name} joined as ${role} (isHost: ${participant.isHost}, participantId: ${participantId})`);
      
      socket.emit('meetingJoined', {
        meetingCode: code,
        participantId,
        role,
        participants: meeting.getParticipantsArray(),
        metricsStarted: !!meeting.metricsStartedAt,
      });

      // Notify all participants (including moderator) about new joiner
      const participantData = {
        id: participantId,
        name: participant.name,
        speakingTime: 0,
        totalTime: 0,
        isActive: true,
        isSpeaking: false,
        inQueue: false,
        avatar: participant.avatar,
        isHost: participant.isHost,
        isMuted: participant.isMuted !== undefined ? participant.isMuted : false,
        isVideoOff: participant.isVideoOff !== undefined ? participant.isVideoOff : false,
      };

      // Send to ALL participants in the meeting room (including moderator)
      io.to(code).emit('participantJoined', {
        participant: participantData,
      });
      
      console.log(`Notified all participants in ${code} about new joiner: ${participant.name}`);

      // Notify ALL existing participants (including moderator) to create peer connection with new joiner
      socket.to(code).emit('webrtc-new-peer', {
        peerId: participantId,
        peerName: participant.name,
      });
      
      // Send current media states of all participants to the new joiner
      for (const [pId, p] of meeting.participants.entries()) {
        if (pId !== participantId && (p.isMuted !== undefined || p.isVideoOff !== undefined)) {
          socket.emit('participantMediaStateUpdate', {
            participantId: pId,
            isMuted: p.isMuted || false,
            isVideoOff: p.isVideoOff || false,
          });
        }
      }

      // Notify new joiner about ALL existing participants (including moderator) for peer connections
      const existingParticipants = Array.from(meeting.participants.values())
        .filter(p => p.id !== participantId)
        .map(p => ({
          peerId: p.id,
          peerName: p.name,
        }));
      
      if (existingParticipants.length > 0) {
        // Small delay to ensure socket is ready
        setTimeout(() => {
          socket.emit('webrtc-existing-peers', {
            peers: existingParticipants,
          });
        }, 500);
      }

      // Send current meeting state to new participant
      meeting.calculateFairnessMetrics();
      socket.emit('meetingState', {
        participants: meeting.getParticipantsArray(),
        analytics: meeting.analytics,
        queue: meeting.queue.map(id => {
          const p = meeting.participants.get(id);
          return p ? { id: p.id, name: p.name, position: p.queuePosition } : null;
        }).filter(Boolean),
        metricsStarted: !!meeting.metricsStartedAt,
        chatMessages: meeting.getChatMessages(),
      });

      console.log(`${name} joined meeting ${code}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // Update speaking status
  socket.on('updateSpeakingStatus', ({ meetingCode, participantId, isSpeaking }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    meeting.updateSpeakingStatus(participantId, isSpeaking);
    meeting.calculateFairnessMetrics();

    // Broadcast to all participants
    io.to(meetingCode).emit('participantUpdate', {
      participants: meeting.getParticipantsArray(),
      analytics: meeting.analytics,
    });

    // Check for long turns
    const longTurns = meeting.checkLongTurns();
    longTurns.forEach(({ participantId: pId, participantName, duration }) => {
      io.to(meetingCode).emit('longTurnDetected', {
        participantId: pId,
        participantName,
        duration: Math.round(duration),
      });
    });
  });

  // Add transcript text (from speech recognition)
  // Track last sent transcript per participant to prevent duplicates
  const lastTranscripts = new Map(); // Map<meetingCode-participantId, {text, timestamp}>
  
  socket.on('addTranscriptText', ({ meetingCode, participantId, text }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) {
      console.warn(`[Transcript] Meeting ${meetingCode} not found for transcript text`);
      return;
    }

    if (!text || text.trim().length === 0) {
      console.warn(`[Transcript] Empty text received for participant ${participantId}`);
      return;
    }

    const trimmedText = text.trim();
    const key = `${meetingCode}-${participantId}`;
    const now = Date.now();
    const lastEntry = lastTranscripts.get(key);
    
    // Prevent duplicate transcripts (same text from same participant within 3 seconds)
    if (lastEntry && lastEntry.text === trimmedText && (now - lastEntry.timestamp) < 3000) {
      console.log(`[Transcript] Duplicate transcript ignored for ${participantId}: "${trimmedText.substring(0, 50)}"`);
      return;
    }

    // Get participant info to verify and log
    const participant = meeting.participants.get(participantId);
    if (!participant) {
      console.warn(`[Transcript] Participant ${participantId} not found in meeting ${meetingCode}`);
      return;
    }
    
    const participantName = participant.name;
    console.log(`[Transcript] Text from ${participantName} (${participantId}): "${trimmedText.substring(0, 50)}${trimmedText.length > 50 ? '...' : ''}"`);

    meeting.addTranscriptText(participantId, trimmedText);
    console.log(`[Transcript] Total transcript entries: ${meeting.transcript.length}`);
    console.log(`[Transcript] Entries with text: ${meeting.transcript.filter(e => e.text && e.text.trim().length > 0).length}`);

    // Update last transcript tracking
    lastTranscripts.set(key, { text: trimmedText, timestamp: now });

    // Broadcast caption line to all clients in the room
    io.to(meetingCode).emit('captionLine', {
      participantId,
      participantName,
      text: trimmedText,
      timestamp: now,
    });
  });

  // Get AI topic suggestions
  socket.on('getAISuggestions', async ({ meetingCode }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) {
      socket.emit('error', { message: 'Meeting not found' });
      return;
    }

    try {
      const suggestions = await aiService.generateTopicSuggestions({
        participants: Array.from(meeting.participants.values()).map(p => ({
          name: p.name,
          speakingTime: p.speakingTime,
        })),
        duration: meeting.metricsStartedAt ? (Date.now() - meeting.metricsStartedAt) / 1000 : 0,
        transcript: meeting.transcript,
      });

      socket.emit('aiSuggestions', {
        suggestions,
      });
    } catch (error) {
      console.error('[AI] Error generating suggestions:', error);
      socket.emit('error', { message: 'Failed to generate AI suggestions' });
    }
  });

  // Raise hand / Add to queue
  socket.on('raiseHand', ({ meetingCode, participantId }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    const added = meeting.addToQueue(participantId);
    if (added) {
      const participant = meeting.participants.get(participantId);
      
      // Notify moderator
      const host = Array.from(meeting.participants.values()).find(p => p.isHost);
      if (host) {
        io.to(host.socketId).emit('handRaised', {
          participantId,
          participantName: participant.name,
          queuePosition: participant.queuePosition,
        });
      }

      // Broadcast queue update
      io.to(meetingCode).emit('queueUpdate', {
        queue: meeting.queue.map(id => {
          const p = meeting.participants.get(id);
          return p ? { id: p.id, name: p.name, position: p.queuePosition } : null;
        }).filter(Boolean),
      });
    }
  });

  // Remove from queue
  socket.on('removeFromQueue', ({ meetingCode, participantId }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    meeting.removeFromQueue(participantId);
    
    io.to(meetingCode).emit('queueUpdate', {
      queue: meeting.queue.map(id => {
        const p = meeting.participants.get(id);
        return p ? { id: p.id, name: p.name, position: p.queuePosition } : null;
      }).filter(Boolean),
    });
  });

  // Reorder queue (moderator only)
  socket.on('reorderQueue', ({ meetingCode, newOrder }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    const participant = Array.from(meeting.participants.values())
      .find(p => p.socketId === socket.id);
    
    if (!participant || !participant.isHost) {
      socket.emit('error', { message: 'Only moderator can reorder queue' });
      return;
    }

    const success = meeting.reorderQueue(newOrder);
    if (success) {
      io.to(meetingCode).emit('queueUpdate', {
        queue: meeting.queue.map(id => {
          const p = meeting.participants.get(id);
          return p ? { id: p.id, name: p.name, position: p.queuePosition } : null;
        }).filter(Boolean),
      });
    }
  });

  // Send nudge
  socket.on('sendNudge', ({ meetingCode, fromParticipantId, toParticipantId, message, template }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    const fromParticipant = meeting.participants.get(fromParticipantId);
    const toParticipant = meeting.participants.get(toParticipantId);
    
    if (!fromParticipant || !toParticipant) return;

    const nudge = meeting.sendNudge(fromParticipantId, toParticipantId, message, template);

    // Send nudge privately to recipient
    io.to(toParticipant.socketId).emit('nudgeReceived', {
      id: nudge.id,
      message: nudge.message,
      from: fromParticipant.name,
      template: nudge.template,
    });

    // Notify moderator
    const host = Array.from(meeting.participants.values()).find(p => p.isHost);
    if (host) {
      io.to(host.socketId).emit('nudgeSent', {
        from: fromParticipant.name,
        to: toParticipant.name,
        message: nudge.message,
      });
    }
  });

  // Start Icebreaker
  socket.on('startIcebreaker', async ({ meetingCode, duration }) => {
    console.log(`[startIcebreaker] Request for meeting ${meetingCode}`);
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) {
      socket.emit('error', { message: 'Meeting not found' });
      return;
    }

    const participant = Array.from(meeting.participants.values())
      .find(p => p.socketId === socket.id);
    
    if (!participant || !participant.isHost) {
      socket.emit('error', { message: 'Only moderator can start icebreaker' });
      return;
    }

    try {
      // Generate icebreaker question using AI
      console.log('[startIcebreaker] Generating icebreaker question...');
      const question = await aiService.generateIcebreaker('professional team meeting');
      console.log('[startIcebreaker] Generated question:', question);
      
      // Start icebreaker in meeting
      meeting.startIcebreaker(question, duration || 120);
      
      // Broadcast icebreaker to all participants
      console.log('[startIcebreaker] Broadcasting to room:', meetingCode);
      io.to(meetingCode).emit('icebreakerStarted', {
        question,
        timer: duration || 120,
        responses: [],
        totalParticipants: meeting.participants.size,
        respondedCount: 0,
      });

      console.log(`[startIcebreaker] Icebreaker started for meeting ${meetingCode}: "${question}"`);
    } catch (error) {
      console.error('[startIcebreaker] Error:', error);
      socket.emit('error', { message: 'Failed to start icebreaker' });
    }
  });

  // Participant responds to icebreaker
  socket.on('icebreakerParticipate', ({ meetingCode, userName, response }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    meeting.recordIcebreakerResponse(userName, response);
    
    const icebreakerData = meeting.getIcebreakerData();

    // Broadcast updated responses to all
    io.to(meetingCode).emit('icebreakerUpdate', {
      responses: icebreakerData.responses,
      respondedCount: icebreakerData.respondedCount,
      totalParticipants: icebreakerData.totalParticipants,
    });

    console.log(`[icebreakerParticipate] ${userName} responded in meeting ${meetingCode}`);
  });

  // Close/End icebreaker
  socket.on('closeIcebreaker', ({ meetingCode }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    meeting.endIcebreaker();

    // Broadcast to all participants that icebreaker ended
    io.to(meetingCode).emit('icebreakerClosed');

    console.log(`[closeIcebreaker] Icebreaker ended for meeting ${meetingCode}`);
  });

  // End meeting
  socket.on('endMeeting', async ({ meetingCode }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) {
      socket.emit('error', { message: 'Meeting not found' });
      return;
    }

    const participant = Array.from(meeting.participants.values())
      .find(p => p.socketId === socket.id);
    
    if (!participant || !participant.isHost) {
      socket.emit('error', { message: 'Only moderator can end meeting' });
      return;
    }

    // Get summary before ending
    const summary = meeting.getSummary();
    
    // Log transcript status before generating summary
    const transcriptWithText = meeting.transcript.filter(e => e.text && e.text.trim().length > 0);
    console.log('[AI] Meeting ending - Transcript status:', {
      totalEntries: meeting.transcript.length,
      entriesWithText: transcriptWithText.length,
      sampleEntries: meeting.transcript.slice(0, 3).map(e => ({
        participant: e.participantName,
        hasText: !!(e.text && e.text.trim().length > 0),
        textPreview: e.text ? e.text.substring(0, 30) + '...' : 'NO TEXT',
      })),
    });
    
    // Generate AI summary using meeting data
    let aiSummary = null;
    try {
      console.log('[AI] Generating meeting summary...');
      const summaryResult = await aiService.generateMeetingSummary({
        participants: Array.from(meeting.participants.values()).map(p => ({
          name: p.name,
          speakingTime: p.speakingTime,
          turnCount: p.turnCount,
        })),
        duration: meeting.metricsStartedAt ? (Date.now() - meeting.metricsStartedAt) / 1000 : 0,
        analytics: summary.analytics,
        transcript: meeting.transcript, // Include the full transcript with speech content
      });
      aiSummary = summaryResult.summary;
      meeting.aiSummary = aiSummary;
      console.log('[AI] Meeting summary generated successfully');
    } catch (error) {
      console.error('[AI] Failed to generate meeting summary:', error.message);
    }
    
    // Save transcript to file
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const transcriptData = {
        meetingCode: meeting.code,
        startTime: meeting.createdAt,
        endTime: new Date(),
        duration: meeting.metricsStartedAt ? (Date.now() - meeting.metricsStartedAt) / 1000 : 0,
        participants: Array.from(meeting.participants.values()).map(p => ({
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          speakingTime: p.speakingTime,
          turnCount: p.turnCount,
        })),
        transcript: meeting.transcript,
        analytics: summary.analytics,
        aiSummary: aiSummary,
      };
      
      const transcriptsDir = path.join(process.cwd(), 'transcripts');
      await fs.mkdir(transcriptsDir, { recursive: true });
      
      const filename = `transcript_${meeting.code}_${Date.now()}.json`;
      const filepath = path.join(transcriptsDir, filename);
      
      await fs.writeFile(filepath, JSON.stringify(transcriptData, null, 2));
      console.log(`[Transcript] Saved to ${filepath}`);
    } catch (error) {
      console.error('[Transcript] Failed to save transcript:', error.message);
    }
    
    // Mark meeting as ended
    meetingService.endMeeting(meetingCode);

    // Broadcast to ALL participants that meeting has ended
    io.to(meetingCode).emit('meetingEnded', { 
      summary,
      aiSummary,
    });
    
    // Disconnect all sockets from the meeting room
    const sockets = io.sockets.adapter.rooms.get(meetingCode);
    if (sockets) {
      sockets.forEach(socketId => {
        const clientSocket = io.sockets.sockets.get(socketId);
        if (clientSocket) {
          clientSocket.leave(meetingCode);
        }
      });
    }
    
    console.log(`Meeting ${meetingCode} ended by moderator ${participant.name}`);
  });

  // Leave meeting
  socket.on('leaveMeeting', ({ meetingCode, participantId }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    meeting.removeParticipant(participantId);
    socket.leave(meetingCode);

    // Notify others
    socket.to(meetingCode).emit('participantLeft', {
      participantId,
      participants: meeting.getParticipantsArray(),
    });

    console.log(`Participant ${participantId} left meeting ${meetingCode}`);
  });

  // WebRTC Signaling
  socket.on('webrtc-offer', ({ meetingCode, peerId, offer }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) {
      console.error(`[WebRTC] Meeting ${meetingCode} not found for offer`);
      return;
    }

    // Find sender's participant ID
    const senderParticipant = Array.from(meeting.participants.values())
      .find(p => p.socketId === socket.id);
    
    if (!senderParticipant) {
      console.error(`[WebRTC] Sender not found for socket ${socket.id}`);
      return;
    }

    const targetParticipant = Array.from(meeting.participants.values())
      .find(p => p.id === peerId);
    
    if (targetParticipant) {
      console.log(`[WebRTC] Forwarding offer from ${senderParticipant.name} (${senderParticipant.id}) to ${targetParticipant.name} (${peerId})`);
      io.to(targetParticipant.socketId).emit('webrtc-offer', {
        peerId: senderParticipant.id,
        offer,
      });
    } else {
      console.error(`[WebRTC] Target participant ${peerId} not found`);
    }
  });

  socket.on('webrtc-answer', ({ meetingCode, peerId, answer }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) {
      console.error(`[WebRTC] Meeting ${meetingCode} not found for answer`);
      return;
    }

    // Find sender's participant ID
    const senderParticipant = Array.from(meeting.participants.values())
      .find(p => p.socketId === socket.id);
    
    if (!senderParticipant) {
      console.error(`[WebRTC] Sender not found for socket ${socket.id}`);
      return;
    }

    const targetParticipant = Array.from(meeting.participants.values())
      .find(p => p.id === peerId);
    
    if (targetParticipant) {
      console.log(`[WebRTC] Forwarding answer from ${senderParticipant.name} (${senderParticipant.id}) to ${targetParticipant.name} (${peerId})`);
      io.to(targetParticipant.socketId).emit('webrtc-answer', {
        peerId: senderParticipant.id,
        answer,
      });
    } else {
      console.error(`[WebRTC] Target participant ${peerId} not found`);
    }
  });

  socket.on('webrtc-ice-candidate', ({ meetingCode, peerId, candidate }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    // Find sender's participant ID
    const senderParticipant = Array.from(meeting.participants.values())
      .find(p => p.socketId === socket.id);
    
    if (!senderParticipant) return;

    const targetParticipant = Array.from(meeting.participants.values())
      .find(p => p.id === peerId);
    
    if (targetParticipant) {
      console.log(`[WebRTC] Forwarding ICE candidate from ${senderParticipant.id} to ${peerId}`);
      io.to(targetParticipant.socketId).emit('webrtc-ice-candidate', {
        peerId: senderParticipant.id,
        candidate,
      });
    }
  });

  // Emoji reactions
  socket.on('sendEmoji', ({ meetingCode, participantId, emoji }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    console.log(`Emoji reaction from ${participantId}: ${emoji}`);

    // Broadcast emoji to all participants
    io.to(meetingCode).emit('emojiReaction', {
      participantId,
      emoji,
      timestamp: Date.now(),
    });
  });

  // Lightweight meeting chat
  socket.on('sendChatMessage', ({ meetingCode, participantId, message }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    const chatMessage = meeting.addChatMessage(participantId, message);
    if (!chatMessage) return;

    io.to(meetingCode).emit('chatMessage', chatMessage);
  });

  // Participant media state (mic/video)
  socket.on('participantMediaState', ({ meetingCode, participantId, isMuted, isVideoOff }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    console.log(`Media state update: ${participantId} - muted: ${isMuted}, videoOff: ${isVideoOff}`);

    // Update participant media state in backend
    const participant = meeting.participants.get(participantId);
    if (participant) {
      participant.isMuted = isMuted;
      participant.isVideoOff = isVideoOff;
    }

    // Broadcast media state to all participants
    io.to(meetingCode).emit('participantMediaStateUpdate', {
      participantId,
      isMuted,
      isVideoOff,
    });
  });

  // Periodic fairness updates (only if metrics have started)
  setInterval(() => {
    for (const [code, meeting] of meetingService.meetings.entries()) {
      if (meeting.endedAt || !meeting.metricsStartedAt) continue;

      // Update speaking times for active speakers (only if metrics started)
      const now = Date.now();
      for (const participant of meeting.participants.values()) {
        if (participant.isSpeaking && participant.lastSpokeAt) {
          const elapsed = (now - participant.lastSpokeAt) / 1000;
          if (elapsed > 0) {
            participant.continuousSpeakingTime += elapsed;
            participant.speakingTime += elapsed;
            participant.lastSpokeAt = now;
          }
        }
      }

      // Calculate fairness metrics
      meeting.calculateFairnessMetrics();

      // Broadcast updates
      io.to(code).emit('fairnessUpdate', {
        participants: meeting.getParticipantsArray(),
        analytics: meeting.analytics,
        metricsStarted: !!meeting.metricsStartedAt,
      });
    }
  }, 1000); // Update every second

  // Start metrics tracking (moderator only)
  socket.on('startMetrics', ({ meetingCode }) => {
    const meeting = meetingService.getMeeting(meetingCode);
    if (!meeting) return;

    const participant = Array.from(meeting.participants.values())
      .find(p => p.socketId === socket.id);
    
    if (!participant || !participant.isHost) {
      socket.emit('error', { message: 'Only moderator can start metrics' });
      return;
    }

    const started = meeting.startMetrics();
    if (started) {
      // Notify all participants that metrics have started
      io.to(meetingCode).emit('metricsStarted', {
        startedAt: meeting.metricsStartedAt,
      });
      console.log(`Metrics started for meeting ${meetingCode}`);
    }
  });

  // Disconnect handler - DON'T remove participant, just mark as disconnected
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    // Find participant but DON'T remove them - keep their metrics
    // Just clear their socket ID so they can reconnect
    for (const [code, meeting] of meetingService.meetings.entries()) {
      for (const [participantId, participant] of meeting.participants.entries()) {
        if (participant.socketId === socket.id) {
          // Clear socket ID but keep participant and their metrics
          participant.socketId = null;
          // Don't remove from meeting - they can reconnect
          console.log(`Participant ${participant.name} disconnected but kept in meeting`);
          break;
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log(`🚀 FairMeet Backend Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready`);
  console.log(`🔗 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
});

