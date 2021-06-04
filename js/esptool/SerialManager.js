class SerialManager {

  constructor(logFunction) {
    this.reader = null;
    this.logFunction = logFunction;
    this.lineBuffer = [];
    this.messageReceiver = null;
  }

  flushbuffer() {
    this.lineBuffer = [];
  }


  async sendAndGetResponse(bytes) {

    this.flushbuffer();

    await this.sendBytes(bytes);

    let result = await this.getSLIPpacket();

    return result;
  }

  async getSLIPpacket() {

    console.log("Get SLIP packet");

    if (this.gotLinesToRead()) {
      console.log('Reading from buffer');
      return this.readFromBuffer();
    }

    let partialPacket = null;
    let inEscape = false;
    let mostRecentMessage = null;

    while (this.port.readable && mostRecentMessage == null) {

      this.reader = this.port.readable.getReader();

      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) {
            console.log("Port is done.");
            // reader.cancel() has been called.
            break;
          }
          for (let b of value) {
            if (partialPacket == null) {
              // Start of a packet
              if (b == 0xc0) {
                partialPacket = [];
              }
            }
            else {
              // Adding bytes to a packet
              if (inEscape) {
                // part-way through escape sequence
                this.in_escape = false;

                if (b == 0xdc) {
                  partialPacket.push(0xc0);
                }
                else if (b == 0xdd) {
                  partialPacket.push(0xdb);
                }
                else {
                  partialPacket = null;
                }
              }
              else {
                // not in escape sequence
                if (b == 0xdb) {
                  // start of escape sequence
                  inEscape = true;
                }
                else if (b == 0xc0) {
                  // marks the end of a message
                  // If we get out of step with 0xC0 markers we 
                  // will get two 0xC0 values in succession 
                  // (one marks the end of one packet and the other 
                  // the start of the next one. )
                  // If this is the case the partial packet will 
                  // be empty. Only send non-empty packets
                  if (partialPacket.length > 0) {
                    console.log("Got SLIP:" + partialPacket);
                    this.lineBuffer.push(partialPacket);
                    mostRecentMessage = partialPacket;
                    partialPacket = null;
                  }
                }
                else {
                  partialPacket.push(b);
                }
              }
            }
          }
          console.log("Loop done");
          if (mostRecentMessage != null) {
            console.log("breaking out");
            break;
          }
        }
      } catch (error) {
        console.log("Serial error:" + error.message);
      } finally {
        // Allow the serial port to be closed later.
        this.reader.releaseLock();
      }
    }

    if (!this.port.readable) {
      console.log("port is no longer readable");
    }
    // return the oldest line
    return this.lineBuffer.shift();
  }

  readFromBuffer() {
    return this.lineBuffer.shift();
  }

  gotLinesToRead() {
    return this.lineBuffer.length > 0;
  }


  async connectToSerialPort() {
    // Prompt user to select any serial port.

    if (!"serial" in navigator) {
      this.port = null;
      return { worked: false, message: "This browser doesn't support serial connection. Try Edge or Chrome." };
    }

    try {
      this.port = await navigator.serial.requestPort();
      await this.port.open({ baudRate: 115200, bufferSize: 10000 });
    }
    catch (error) {
      return { worked: false, message: `Serial port open failed:${error.message}` };
    }

    return { worked: true, message: "Connected OK" };
  }

  async closeSerialPort() {
    if (this.reader) {
      console.log("Closing the port");
      await this.reader.releaseLock();
    }
    await this.port.close();
    this.reader = null;
  }


  async sendBytes(bytes) {
    let buffer = "";
    let limit = bytes.length<10?bytes.length:10;
    for(let i=0;i<limit;i++){
      buffer = buffer + bytes[i].toString(10)+":"+bytes[i].toString(16)+"  ";
    }
    console.log(`Sending:${buffer}...`);
    const writer = this.port.writable.getWriter();
    await writer.write(bytes);
    writer.releaseLock();
  }

  async delay(timeInMs) {
    return new Promise(async (kept, broken) => {
      setTimeout(async () => {
        return kept("tick");
      }, timeInMs);
    });
  }

  async resetIntoBootloader() {
    console.log("Resetting into the Bootloader");
    await this.port.setSignals({ dataTerminalReady: false });
    await this.port.setSignals({ requestToSend: true });
    await this.delay(100);
    await this.port.setSignals({ dataTerminalReady: true });
    await this.port.setSignals({ requestToSend: false });
    await this.delay(50);
    await this.port.setSignals({ dataTerminalReady: false });
    console.log("Reset into bootloader");
  }

  async hardReset() {
    console.log("Hard resetting");
    await this.port.setSignals({ requestToSend: true });
    await this.delay(100);
    await this.port.setSignals({ requestToSend: false });
    await this.delay(50);
    console.log("Hard reset");
  }

  async doTest() {
    console.log("Testing the serial port");

    let { worked, message } = await this.connectToSerialPort();

    console.log(message);

    if (!worked) {
      return { worked: false, message };
    }

    await this.resetIntoBootloader();

    console.log("Sending sync command");

    let syncCommand = new Uint8Array([192, 0, 8, 36, 0, 0, 0, 0, 0, 7, 7, 18, 32, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 85, 192]);

    // send an initial sync to allow the device to get the baud rate
    await this.sendBytes(syncCommand);

    // now get a sync response
    let response = await this.sendAndGetResponse(syncCommand);

    console.log("Got response: ", response);

    for (let i = 0; i < 10; i++) {
      console.log('Attempt ' + i);

      // now get a sync response
      response = await this.sendAndGetResponse(syncCommand);

      console.log("Got response again: ", response);
    }
  }

  async startTerminal(messageReceiver) {
    this.keepReading=true;
    this.messageReceiver = messageReceiver;
    await this.pumpReceivedCharacters(messageReceiver);
  }

  async pumpReceivedCharacters() {
    while (this.port.readable && this.keepReading) {
      this.reader = this.port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) {
            break;
          }
          // value is a Uint8Array.
          var text = new TextDecoder("utf-8").decode(value);
          this.messageReceiver(text);
        }
      } catch (error) {
        console.log(`Serial error:${error.message}`);
      } finally {
        // Allow the serial port to be closed later.
        this.reader.releaseLock();
      }
    }
    await this.port.close();
  }

  async writeUint8Array(valArray) {
    await this.sendBytes(valArray);
  }
}
