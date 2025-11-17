# FairMeet Backend Service

Research-grade backend server for FairMeet - A Human-Centered Meeting Moderation System.

## Features

- ✅ **Auto-generated 6-digit meeting codes**
- ✅ **Automatic role assignment** (first person = moderator)
- ✅ **Real-time WebSocket communication** (Socket.io)
- ✅ **Research-grade fairness metrics** (Gini coefficient)
- ✅ **Speaking time tracking**
- ✅ **Queue management system**
- ✅ **Private nudge system**
- ✅ **Long-turn detection**
- ✅ **Quiet participant identification**

## Installation

```bash
npm install
```

## Configuration

Create a `.env` file:

```env
PORT=3000
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
```

## Running

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### REST API

- `GET /api/health` - Health check
- `GET /api/meetings/:code/summary` - Get meeting summary

### WebSocket Events

#### Client → Server

- `createMeeting` - Create new meeting
- `joinMeeting` - Join existing meeting
- `updateSpeakingStatus` - Update speaking status
- `raiseHand` - Add to queue
- `removeFromQueue` - Remove from queue
- `reorderQueue` - Reorder queue (moderator only)
- `sendNudge` - Send nudge to participant
- `endMeeting` - End meeting (moderator only)
- `leaveMeeting` - Leave meeting

#### Server → Client

- `meetingCreated` - Meeting created confirmation
- `meetingJoined` - Meeting joined confirmation
- `participantJoined` - New participant joined
- `participantLeft` - Participant left
- `participantUpdate` - Participant state update
- `fairnessUpdate` - Fairness metrics update
- `queueUpdate` - Queue state update
- `handRaised` - Hand raised notification (to moderator)
- `nudgeReceived` - Nudge received (private)
- `nudgeSent` - Nudge sent notification (to moderator)
- `longTurnDetected` - Long turn detected
- `meetingEnded` - Meeting ended
- `meetingState` - Current meeting state
- `error` - Error message

## Research Metrics

The backend implements research-grade fairness metrics based on the academic paper:

- **Gini Coefficient**: Measures inequality in speaking time distribution
- **Fairness Score**: F = 1 - G (0-1 scale, higher = more fair)
- **Participation Entropy**: Shannon entropy for participation diversity
- **Dominance Index**: Ratio of max speaking time to total duration
- **Long-Turn Detection**: Identifies continuous speaking > threshold (default 60s)

## Architecture

```
svc-fairmeet/
├── src/
│   ├── models/
│   │   └── Meeting.js          # Meeting model with state management
│   ├── services/
│   │   └── MeetingService.js   # Meeting service layer
│   ├── utils/
│   │   └── fairnessMetrics.js  # Research-grade fairness calculations
│   └── server.js               # Main server with WebSocket handlers
├── package.json
└── README.md
```

## Integration with Frontend

The frontend should connect to:
- **REST API**: `http://localhost:3000/api`
- **WebSocket**: `ws://localhost:3000`

See `README_BACKEND_READY.md` in the frontend for integration details.

