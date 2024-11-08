// server.js
const net = require('net');
var tpidefs = require('./tpi.js');
var EventEmitter = require('events');
var config;
var vs;

class EVL4Simulator { 

  constructor() 
  { 
    this.simulatedAlarmState = '0'; 

    this.TPI_TO_MESSAGE = {
      '2':'away',
      '6':'bypass',
      '1': 'disarm',
      '33': 'night',
      '3' : 'stay'
    }
  };

  simulateCommand(packet) {
    
    var tpi_cmd = packet.match(/\^(.+)\$/); // pull out everything between the ^ sand $.

    if (tpi_cmd != null)
    {
        if(command == tpi_cmd[1].split(',')[0]) 
          if ((command == tpidefs.alarmcommand.away) || (command == tpidefs.alarmcommand.night) || (command == tpidefs.alarmcommand.instant) || (command == tpidefs.alarmcommand.max) || (command == tpidefs.alarmcommand.stay)) {
            this.simulatedAlarmState = command;
          } else if (command ==  tpidefs.alarmcommand.disarm) {
            this.simulatedAlarmState = '0';
          }   
    }
    return '^' + command + ',00 $\r\n';

  }

  simulateMessage()
  {
    var evl_ret;
    if (this.simulatedAlarmState == '0') {
      evl_ret = '%00,01,1C08,08,00, VIRTUAL SYSTEM   Ready to Arm  $\r\n';
    }
    else {
      evl_ret = '%00,01,1C08,08,00, VIRTUAL SYSTEM   '+this.TPI_TO_MESSAGE [this.simulatedAlarmState ] +'  $\r\n';
    }
  }
    
  disarm() { 
    this.simulatedAlarmState = false; 
    console.log("Alarm disarmed.");
  }

  armed() { 
    this.simulatedAlarmState = true;
    console.log("Alarm armed."); 
  }
  
  simulateIntrusion(){ 
    if (this.armed) { 
      console.log("Intrusion detected. Triggering full alarm."); 
      } 
  } 
   
}

// Example usage: const evl4 = new EVL4Simulator(); // Arm the system evl4.arm(); // Activate night mode evl4.activateNightMode(); // Simulate an intrusionevl4.simulateIntrusion(); // Disarm the system evl4.disarm();
class VirtualEnvisaLink extends EventEmitter {

  port;
  password;
  vServer;
  envisaClients = [];
  evlEmulator;

  constructor(log, config) {
    this.log = log;
    //this.port = config.port ? config.port : 4025;
    //this.password = config.password ? config.password : "user";
    //this.bEmulatormode = config.emulator ? config.emulator : false;
    this.port = 4025;
    this.password = "user";
    this.bEmulatormode = true;
    this.vServer;
    this.envisaClients;
    this.evlEmulator = new EVL4Simulator();
  };

  initVisualServer() {

    this.vServer = net.createServer( (socket) => {
      // 'connection' listener.
      // Send login prompt to client

      socket.setEncoding('utf8');

      // Put this new client in the list
      socket.name = socket.remoteAddress + ":" + socket.remotePort;
      socket.isAuthenticated = false;
      console.log(`${socket.name} connected.`);
      // Add this client to broadcast list
      this.envisaClients.push(socket);

      socket.write("Login:  \r\n");
      this.bClientConnected = 0;

      socket.on('data', (data) => {
        console.log(`Received data from client: ${data}`);
        var strData = data.toString();
        if (socket.isAuthenticated == false) {
            // confirm password
            if (strData.trim() == this.password) {
              socket.isAuthenticated = true;
              // If emulator mode generate internal messages
              if (this.bEmulatormode) {this.tpiMessageEmulator();}
            }
            else { 
              // Incorrect password and terminate connection
              socket.write("FAILED\r\n");
              socket.end();
            }
        } 
        else {
            if(strData.substring(0,1)!='%'){
              // emit command sent by the client 
              this.emit('appcommand', {
                data: strData.trim()
              });
            }
        }
      });
  
      socket.on('end', () => {
        // Clean up client list
        this.envisaClients.splice(this.envisaClients.indexOf(socket), 1);
        console.log(`${socket.name} disconnected.`);
      });
  
      socket.on("error", (error) => {
        console.log(`Socket Error: ${error.message}`);
      });

    });

    this.vServer.listen(this.port, () => {
      console.log(`Envisalink virtual server listening on port ${this.port}`);
    });
  }

  broadcastMessage(tpimessage) {
    if (this.envisaClients.length>=1) {
      this.envisaClients.forEach(function (eClient) {
        if (eClient.isAuthenticated) { eClient.write(tpimessage); }
      });
    }
  }

  tpiMessageEmulator() {
    var myVar = setInterval(function(){vs.broadcastMessage(this.evlEmulator.simulateMessage())}, 3000);
  }

}


vs = new VirtualEnvisaLink(console.log, config);
vs.initVisualServer();


