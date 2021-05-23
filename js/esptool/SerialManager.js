class SerialManager {

  constructor(logFunction) {
    this.reader = null;
    this.logFunction = logFunction;
    this.lineBuffer = [];
  }

  flushbuffer(){
    this.lineBuffer=[];
  }


  async sendAndGetResponse(bytes) {

    this.flushbuffer();

    await this.sendBytes(bytes);

    let result = await this.getSLIPpacket();

    return result;
  }

  async getSLIPpacket(){

    console.log("Get SLIP packet");

    if(this.gotLinesToRead()){
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

  readFromBuffer()
  {
    return this.lineBuffer.shift();
  }

  gotLinesToRead(){
    return this.lineBuffer.length>0;
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

  async sendBytes(bytes) {
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

  async read(timeout) {

    if (this.reader == null){
      this.reader = this.port.readable.getReader();
    }

    let timeoutId;
    let timeoutPromise = new Promise(
      (resolve, reject) =>
        this.timeoutId = setTimeout(
          () => reject(new Error("Timeout")),
          timeout
        )
    );
    if (!this.readPromise) {
      this.readPromise = this.reader.read();
    }
    let result;
    try{
     result = await Promise.race([this.readPromise, timeoutPromise]);
    }
    catch (error)
    {
      console.log("inner error:"+error.message);
      result=null;
    }
    finally{
      this.reader.releaseLock();
    }
    this.readPromise = null;
    clearTimeout(this.timeoutId);
    return result;
  }

  async doTimeoutTest() {
    console.log("testing timouts");

    let { worked, message } = await this.connectToSerialPort();

    console.log(message);

    if (!worked) {
      return { worked: false, message };
    }

    this.reader = this.port.readable.getReader();

    let count=0;

    while (true) {
      let message;
      try {
        message = await this.read(1000);
        console.log("Got message:" + message);
      }
      catch (error) {
        if(error.message=="Timeout"){
          console.log("tick");
        }
        else {
          console.log(error.message);
          this.reader.releaseLock();
          this.reader = this.port.readable.getReader();
          if(count++>100){
            break;
          }
        }
      }
    }
  }
}



if (!window.SequentialSerial && "serial" in navigator) {
  class SerialTimeout extends Error {}
  class SerialDisconnected extends Error {}

  class SequentialSerial {

      constructor(port) {
          this.serial = port;
      }

      /**
       * Returns a promise that resolves once the serial port is open and ready.
       * The timeout value specifies how long future calls to read() will wait
       * for data before throwing an exception
       */

      async open(baud, timeout = 5) {
          this.decoder = new TextDecoder();
          this.encoder = new TextEncoder();
          this.timeout = timeout;
          await this.serial.open({baudRate: baud, bufferSize: 65536});
          this.writer = this.serial.writable.getWriter();
          this.reader = this.serial.readable.getReader();
          this.readBytes = [];
          this.readIndex = 0;
      }

      async close() {
          if(this.reader) {
              await this.writer.releaseLock();
              await this.reader.releaseLock();
              await this.serial.close();
              this.reader = null;
              this.writer = null;
          }
      }

      /**
       * Returns a promise that resolves once all output data has been written
       */
      async flush() {
          if(this.reader) {
              await this.writer.ready;
              await this.writer.close();
              this.writer = this.serial.writable.getWriter();
          }
      }

      async discardBuffers() {
          this.readBytes = [];
          this.readIndex = 0;
          await this.reader.releaseLock();
          this.reader = this.serial.readable.getReader();
      }

      toUint8Array(data) {
          let type = Array.isArray(data) ? "array" : typeof data;
          switch(type) {
              case "array":  return Uint8Array.from(data);
              case "string": return this.encoder.encode(data);
              case "object": if(data instanceof Uint8Array) return data;
          }
          console.error("Tried to write unknown type to serial port:", typeof data, data);
      }

      /**
       * Returns a promise that resolves after some data has been written
       */
      write(data) {
          data = this.toUint8Array(data);
          return this.writer.write(data);
      }

      getTimeoutPromise() {
          if(this.timeout) {
              return new Promise(
                  (resolve, reject) =>
                      this.timeoutId = setTimeout(
                          () => reject(new SerialTimeout("Timeout expired while waiting for data")),
                          this.timeout * 1000
                      )
              );
          }
      }

      /**
       * Returns a promise which resolves when "len" bytes have been read.
       */
      async read(len) {
          const timeoutPromise = this.getTimeoutPromise();
          const dst = new Uint8Array(len);
          for(let i = 0; i < len;) {
              if(this.readIndex == this.readBytes.length) {
                  if(!this.readPromise) {
                      this.readPromise = this.reader.read();
                  }
                  const bothPromise = timeoutPromise ? Promise.race([this.readPromise, timeoutPromise]) : this.readPromise;
                  const { value, done } = await bothPromise;
                  this.readPromise = null;
                  if (done) {
                      // Allow the serial port to be closed later.
                      clearTimeout(this.timeoutId);
                      this.reader.releaseLock();
                      throw new SerialDisconnected("Serial port closed while waiting for data");
                  }
                  this.readBytes = value;
                  this.readIndex = 0;
              }
              dst[i++] = this.readBytes[this.readIndex++];
          }
          clearTimeout(this.timeoutId);
          return dst;
      }

      /**
       * Returns a line of text from the serial port.
       */
      async readline() {
          let line = "";
          while(true) {
              let c = this.decoder.decode(await this.read(1));
              switch(c) {
                  case '\r': break;
                  case '\n': return this.encoder.encode(line);
                  default:   line += c;
              }
          }
      }

      /**
       * Returns a promise that resolves after a certain number of miliseconds.
       */
      wait(ms) {
          return new Promise((resolve, reject) => setTimeout(resolve,ms));
      }

      setDTR(value) {
          return this.serial.setSignals({ dataTerminalReady: value });
      }

      getInfo() {
          return this.serial.getInfo();
      }

      /**
       * Returns a promise that resolves to a list of available ports.
       */
      static async getPorts() {
          const ports = await navigator.serial.getPorts();
          return ports.map(p => new SequentialSerial(p));
      }

      static async requestPort(filters) {
          const port = await navigator.serial.requestPort({filters});
          return new SequentialSerial(port);
      }
  }

  // Functionality for preventing machine sleep

  let wakeLock;
  let isPrinting;
  async function setPowerSaveEnabled(enable) {
      if('wakeLock' in navigator) {
          if(enable) {
              try {
                  wakeLock = await navigator.wakeLock.request();
              } catch (err) {
                  console.error(`${err.name}, ${err.message}`);
              }
          } else if(wakeLock) {
              wakeLock.release();
          }
      }
  };

  document.addEventListener('visibilitychange', async () => {
      if(document.visibilityState === 'visible') {
          if (wakeLock !== null) {
              await setPowerSaveEnabled(true);
          }
      }
  });

  window.SequentialSerial    = SequentialSerial;
  window.SerialTimeout       = SerialTimeout;
  window.SerialDisconnected  = SerialDisconnected;
  window.setPowerSaveEnabled = setPowerSaveEnabled;
  window.setPrintInProgress  = enabled => {isPrinting = enabled};

  SequentialSerial.isWebSerial = true;
}

var hasSerial = "SequentialSerial" in window;
