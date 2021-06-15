class ESPToolJS {
    // Commands supported by ESP8266 ROM bootloader
    static ESP_FLASH_BEGIN = 0x02;
    static ESP_FLASH_DATA = 0x03;
    static ESP_FLASH_END = 0x04;
    static ESP_MEM_BEGIN = 0x05;
    static ESP_MEM_END = 0x06;
    static ESP_MEM_DATA = 0x07;
    static ESP_SYNC = 0x08;
    static ESP_WRITE_REG = 0x09;
    static ESP_READ_REG = 0x0a;

    // Some comands supported by ESP32 ROM bootloader (or -8266 w/ stub)
    static ESP_SPI_SET_PARAMS = 0x0B;
    static ESP_SPI_ATTACH = 0x0D;
    static ESP_READ_FLASH_SLOW = 0x0e;  // ROM only, much slower than the stub flash read
    static ESP_CHANGE_BAUDRATE = 0x0F;
    static ESP_FLASH_DEFL_BEGIN = 0x10;
    static ESP_FLASH_DEFL_DATA = 0x11;
    static ESP_FLASH_DEFL_END = 0x12;
    static ESP_SPI_FLASH_MD5 = 0x13;

    // Commands supported by ESP32-S2/S3/C3 ROM bootloader only
    static ESP_GET_SECURITY_INFO = 0x14;

    // Some commands supported by stub only
    static ESP_ERASE_FLASH = 0xD0;
    static ESP_ERASE_REGION = 0xD1;
    static ESP_READ_FLASH = 0xD2;
    static ESP_RUN_USER_CODE = 0xD3;

    // Flash encryption encrypted data command
    static ESP_FLASH_ENCRYPT_DATA = 0xD4;

    // Response code(s) sent by ROM
    static ROM_INVALID_RECV_MSG = 0x05;   // response if an invalid message is received

    // Maximum block sized for RAM and Flash writes, respectively.
    static ESP_RAM_BLOCK = 0x1800;

    static FLASH_WRITE_SIZE = 0x4000;

    // Default baudrate. The ROM auto-bauds, so we can use more or less whatever we want.
    static ESP_ROM_BAUD = 115200;

    // First byte of the application image
    static ESP_IMAGE_MAGIC = 0xe9;

    // Initial state for the checksum routine
    static ESP_CHECKSUM_MAGIC = 0xef;

    // Flash sector size, minimum unit of erase.
    static FLASH_SECTOR_SIZE = 0x1000;

    static UART_DATE_REG_ADDR = 0x60000078;

    static CHIP_DETECT_MAGIC_REG_ADDR = 0x40001000;  // This ROM address has a different value on each chip model

    static UART_CLKDIV_MASK = 0xFFFFF;

    // Memory addresses
    static IROM_MAP_START = 0x40200000;
    static IROM_MAP_END = 0x40300000;

    // The number of bytes in the UART response that signify command status
    static STATUS_BYTES_LENGTH = 2;

    static DEFAULT_TIMEOUT = 3;                   // timeout for most flash operations
    static START_FLASH_TIMEOUT = 20;              // timeout for starting flash (may perform erase)
    static CHIP_ERASE_TIMEOUT = 120;              // timeout for full chip erase
    static MAX_TIMEOUT = ESPToolJS.CHIP_ERASE_TIMEOUT * 2;  // longest any command can run
    static SYNC_TIMEOUT = 0.1;                    // timeout for syncing with bootloader
    static MD5_TIMEOUT_PER_MB = 8;                // timeout (per megabyte) for calculating md5sum
    static ERASE_REGION_TIMEOUT_PER_MB = 30;      // timeout (per megabyte) for erasing a region
    static MEM_END_ROM_TIMEOUT = 0.05;            // special short timeout for ESP_MEM_END, as it may never respond
    static DEFAULT_SERIAL_WRITE_TIMEOUT = 10;     // timeout for serial port write
    static DEFAULT_CONNECT_ATTEMPTS = 7;          // default number of times to try connection

    constructor(serialManager, logFunction) {
        this.serialManager = serialManager;
        this.logFunction = logFunction;
        this.logFunction("Starting ESPTool");
    }

    // packs values into a 

    pack(format) {

        if (arguments.length < 2) {
            throw new Exception("pack called with missing arguments");
        }

        let size = 0;
        let argNo = 1;

        for (const ch of format) {
            switch (ch) {
                case '<':
                    break;
                case 'I':
                    size += 4;
                    break;
                case 'B':
                    size += 1;
                    break;
                case 'H':
                    size += 2;
                    break;
                case '$':
                    size += arguments[argNo].length;
                    break;
                default:
                    throw new Error(`Invalid format in pack format:${ch}`);
            }
            argNo++;
        }

        let buffer = new ArrayBuffer(size);
        const data = new Uint8Array(buffer);
        let bpos = 0;
        for (let i = 1; i < arguments.length; i = i + 1) {
            let value = arguments[i];
            switch (format[i - 1]) {
                case 'I':
                    data[bpos++] = value & 0xFF;
                    data[bpos++] = (value >> 8) & 0xFF;
                    data[bpos++] = (value >> 16) & 0xFF;
                    data[bpos++] = (value >> 24) & 0xFF;
                    break;
                case 'B':
                    data[bpos++] = ch;
                    break;
                case 'H':
                    data[bpos++] = value & 0xff;
                    data[bpos++] = (value >> 8) & 0xff;
                    break;
                case '$': // pack from a binary string
                    for (let by = 0; by < value.length; by++) {
                        data[bpos++] = value[by];
                    }
            }
        }
        return data;
    }

    // unpacks 4 bytes into a 32 bit value
    unpackBytesTo32Bit(value) {
        const result = value[0] +
            (value[1] << 8) +
            (value[2] << 16) +
            (value[3] << 24);
        return result;
    }

    // unpacks 2 bytes into a 16 bit value
    unpackBytesTo16Bit(value) {
        const result = value[0] +
            (value[1] >> 8);
        return result;
    }

    checksum(data, state) {
        if (state === undefined) {
            state = ESPToolJS.ESP_CHECKSUM_MAGIC;
        }
        let count = 0;
        for (let i = 0; i < data.length; i++) {
            let b = data[i];
            if (count < 10) {
                count = count + 1;
            }
            state ^= b;
        }
        return state;
    }

    // packs a message into a Uint8Array adding SLIP encoding
    packSlip(message) {
        // find out how many extra spaces we need for escape
        // count the 0xdb and 0xc0 values in the message
        let extra = 0;
        message.map((i) => { if ((i == 0xdb) || (i == 0xC0)) extra++ });

        let inputLength = message.length;

        // add in extra plus space for 0xc0 at start and end
        let totalLength = inputLength + extra + 2;

        let out = new Uint8Array(totalLength);

        let wPos = 0;

        out[wPos++] = 0xc0;

        for (let b of message) {
            switch (b) {
                case 0xdb:
                    out[wPos++] = 0xdb;
                    out[wPos++] = 0xdd;
                    break;

                case 0xc0:
                    out[wPos++] = 0xdb;
                    out[wPos++] = 0xdc;
                    break;

                default:
                    out[wPos++] = b;
            }
        }

        out[wPos++] = 0xc0;

        return out;
    }

    packCommand(opCode, dataBlock, check) {
        let dataLength = dataBlock.length;
        let totalLength = dataLength + 8;
        const message = new Uint8Array(totalLength);
        let pos = 0;
        message[pos++] = 0;
        message[pos++] = opCode;
        message[pos++] = dataLength & 0xff;
        message[pos++] = (dataLength >> 8) & 0xff;
        message[pos++] = check;
        pos += 3;
        for (let i = 0; i < dataLength; i++) {
            let value = dataBlock[i];
            message[pos++] = value & 0xFF;
        }
        return message;
    }

    unpackCommand(value) {
        // Create a dataview for the messages at the start
        let view = new DataView(new ArrayBuffer(8));
        for (let i = 0; i < 8; i++) {
            view.setUint8(i, value[i]);
        }
        let pos = 0;
        let resp = view.getUint8(pos); pos++;
        let opRet = view.getUint8(pos); pos++;
        let lenRet = view.getUint16(pos, true); pos += 2;
        let val = view.getUint32(pos, true);
        let data = value.slice(8, length);
        return { resp: resp, opRet: opRet, lenRet: lenRet, val: val, data: data }
    }

    async delay(timeInMs) {
        return new Promise(async (kept, broken) => {
            setTimeout(async () => {
                return kept("tick");
            }, timeInMs);
        });
    }

    async command(params) {

        if (params.opDescription != undefined) {
            console.log(params.opDescription);
        }

        for (let retry = 0; retry < 5; retry++) {

            this.serialManager.flushbuffer();

            console.log(`  Command send retry: ${retry+1}`);

            let commandMessage = this.packCommand(params.op, params.dataBlock, params.check);

            let slipEncodedCommand = this.packSlip(commandMessage);

            let value = await this.serialManager.sendAndGetResponse(slipEncodedCommand);

            if(value == null){
                console.log("      no response before timeout");
                continue;
            }

            if (value.length < 8) {
                console.log("      block too short");
                continue;
            }

            let response = this.unpackCommand(value);

            if (response.resp != 1) {
                console.log("      response not 1");
                continue;
            }

            if (response.opRet != params.op) {
                console.log(`      invalid response opcode sent:${params.op} received:${response.opRet}`);
                continue;
            }

            let trimmedData = value.slice(8);

            console.log("Read complete");

            return { val: response.val, data: trimmedData };
        }

        // after 5 retries we give up and return null results
        console.log("Command failed");

        return {val:null, data:null};
    }

    async check_command(params) {
        // Execute a command with 'command', check the result code and throw an appropriate
        // FatalError if it fails.

        //  Returns the "result" of a successful command.

        let { val, data } = await this.command(params);

        if(data==null){
            // the command was not sent successfully 
            return null;
        }

        //  things are a bit weird here, bear with us
        //  the status bytes are the last 2/4 bytes in the data (depending on chip)

        if (data.length < ESPToolJS.STATUS_BYTES_LENGTH) {
            throw new Error(`Check command fail: only got ${data.length} byte status response.`);
        }

        // we only care if the first one is non-zero. If it is, the second byte is a reason.
        let firstStatusByte = data[data.length - ESPToolJS.STATUS_BYTES_LENGTH];

        if (firstStatusByte != 0) {
            let secondStatusByte = data[data.length - ESPToolJS.STATUS_BYTES_LENGTH + 1];
            throw new Error(`Check command fail: bad status ${firstStatusByte} ${secondStatusByte}`);
        }

        console.log("command worked");

        // if we had more data than just the status bytes, return it as the result
        // (this is used by the md5sum command, maybe other commands?)
        if (data.length > ESPToolJS.STATUS_BYTES_LENGTH) {
            let trimmedData = data.slice(0, data.length - ESPToolJS.STATUS_BYTES_LENGTH);
            return trimmedData;
        } else {  // otherwise, just return the 'val' field which comes from the reply header (this is used by read_reg)
            return val;
        }
    }

    async readReg(regAddr) {

        const params = {
            op: ESPToolJS.ESP_READ_REG,
            dataBlock: this.pack('I', regAddr),
            check: 0,
            waitResponse: true,
            timeout: ESPToolJS.DEFAULT_TIMEOUT
        };

        let { val, data } = await this.command(params);

        console.log("Got reply:", val);

        return val;
    }

    async sync() {
        console.log("Syncing the connection");
        const params = {
            op: ESPToolJS.ESP_SYNC,
            dataBlock: [0x07, 0x07, 0x12, 0x20,
                0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55,
                0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55,
                0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55,
                0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55, 0x55],
            check: 0,
            waitResponse: true,
            timeout: ESPToolJS.DEFAULT_TIMEOUT
        };
        let { val, data } = await this.command(params);
        return data;
    }

    logMessage(message) {
        console.log(message);
        if (this.logFunction != null) {
            this.logFunction(message);
        }
    }

    // commands

    async detectChip() {

        this.open = true;

        await this.serialManager.resetIntoBootloader();

        this.logMessage("Device reset");

        this.logMessage("Syncing..");

        let syncOK = false;
        let syncError = "";

        for (let i = 0; i < 5; i++) {
            this.logMessage(`  attempt: ${i+1}`);
            try {
                let syncReply = await this.sync();
                if(syncReply == null){
                    this.logMessage("  No response from the device");
                }
                else
                {
                    syncOK=true;
                    break;
                }
            }
            catch (error) {
                console.log(`Sync failed:${error}`);
                this.logMessage(`  Sync error:${error.message}`);
                this.delay(500);
            }
        }

        if (!syncOK) {
            this.logMessage(`Sync abandoned`);
            return null;
        }

        this.logMessage(`Got sync`);

        this.logMessage(`Getting chip version`);

        let chipMagicValue = await this.readReg(ESPToolJS.CHIP_DETECT_MAGIC_REG_ADDR);

        let cls;

        for (cls of [ESP32ROM, ESP8266ROM]) {
            if (cls.CHIP_DETECT_MAGIC_VALUE == chipMagicValue) {
                this.logMessage("Processor detected");
                return cls;
            }
        }
        return null;
    }

    async memBegin(size, blocks, blocksize, offset) {
        const params = {
            opDescription: "enter RAM download mode",
            op: ESPToolJS.ESP_MEM_BEGIN,
            dataBlock: this.pack('IIII', size, blocks, blocksize, offset),
            check: 0,
            waitResponse: true,
            timeout: ESPToolJS.DEFAULT_TIMEOUT
        };

        return await this.check_command(params);
    }

    async memBlock(data, seq) {
        const params = {
            opDescription: "write to target RAM",
            op: ESPToolJS.ESP_MEM_DATA,
            dataBlock: this.pack('IIII$', data.length, seq, 0, 0, data),
            check: this.checksum(data),
            waitResponse: true,
            timeout: ESPToolJS.DEFAULT_TIMEOUT
        };
        return await this.check_command(params);
    }

    async memFinish(entry) {
        const params = {
            opDescription: "leave RAM download mode",
            op: ESPToolJS.ESP_MEM_END,
            dataBlock: this.pack('II', entry == 0 ? 1 : 0, entry),
            check: 0,
            waitResponse: true,
            timeout: ESPToolJS.DEFAULT_TIMEOUT
        };
        return await this.check_command(params);
    }

    createUint8BufferFromBinaryString(str) {
        let aBuffer = new ArrayBuffer(str.length);
        let result = new Uint8Array(aBuffer);
        for (let i = 0; i < str.length; i++) {
            result[i] = str.charCodeAt(i);
        }
        return result;
    }

    async runStub() {

        this.logMessage("Uploading stub");

        for (let field of ['text', 'data']) {
            if (field in this.stub) {
                let dataString = atob(this.stub[field]);
                let data = this.createUint8BufferFromBinaryString(dataString);
                let length = data.length;
                let offs = this.stub[field + "_start"];
                let blocks = Math.floor((length + ESPToolJS.ESP_RAM_BLOCK - 1) / ESPToolJS.ESP_RAM_BLOCK);
                await this.memBegin(length, blocks, ESPToolJS.ESP_RAM_BLOCK, offs);
                for (let seq = 0; seq < blocks; seq++) {
                    let fromOffs = seq * ESPToolJS.ESP_RAM_BLOCK;
                    let toOffs = fromOffs + ESPToolJS.ESP_RAM_BLOCK;
                    await this.memBlock(data.slice(fromOffs, toOffs), seq);
                }
            }
        }

        await this.memFinish(this.stub['entry']);

        // the stub sends the message 'OHAI' when it is running
        // this should have been picked up after the command and buffered by the serial manager
        // Note that this is a special case - not all commands do this

        let response = await this.serialManager.getSLIPpacket();

        console.log("Got run response:", response);

        let result;

        if (response[0] == 79 && response[1] == 72 && response[2] == 65 && response[3] == 73) {
            result = { worked: true, message: `Stub running OK` };
        }
        else {
            result = { worked: false, message: `Invalid response from running stub` };
        }
        return result;
    }

    async flashBegin(size, offset, begin_rom_encrypted = false) {
        let num_blocks = Math.floor((size + ESPToolJS.FLASH_WRITE_SIZE - 1) / ESPToolJS.FLASH_WRITE_SIZE);
        let erase_size = this.get_erase_size(offset, size);

        const params = {
            opDescription: "enter Flash download mode",
            op: ESPToolJS.ESP_FLASH_BEGIN,
            dataBlock: this.pack('IIII', erase_size, num_blocks, ESPToolJS.FLASH_WRITE_SIZE, offset),
            check: 0,
            waitResponse: true,
            timeout: ESPToolJS.DEFAULT_TIMEOUT
        };

        let result = await this.check_command(params);

        return num_blocks;
    }

    async flashBlock(data, seq) {
        const params = {
            opDescription: `write to target Flash after seq ${seq}`,
            op: ESPToolJS.ESP_FLASH_DATA,
            dataBlock: this.pack('IIII$', data.length, seq, 0, 0, data),
            check: this.checksum(data),
            waitResponse: true,
            timeout: ESPToolJS.DEFAULT_TIMEOUT
        };

        let result = await this.check_command(params);
        return result;
    }

    async delay(timeInMs) {
        return new Promise(async (kept, broken) => {
          setTimeout(async () => {
            return kept("tick");
          }, timeInMs);
        });
      }
    
    async flashImage(image, offset) {
        let size = image.length;

        let num_blocks = await this.flashBegin(size, offset);
        let seq = 0;
        let written = 0;

        while (image.length > 0) {
            let address = offset + seq * ESPToolJS.FLASH_WRITE_SIZE;
            this.logFunction(`Writing at 0x${address.toString(16)} (${Math.round(100 * (seq + 1) / num_blocks)}%)`);
            let block = image.slice(0, ESPToolJS.FLASH_WRITE_SIZE);

            let result = await this.flashBlock(block, seq);
            image = image.slice(ESPToolJS.FLASH_WRITE_SIZE);
            seq++;
            written += block.length;
            await this.delay(100); // this delay is only here because the software won't work without it.
        }

        this.logFunction(`\nWrite completed`);

        return { worked: true, message: `Image uploaded` };
    }

    async flashFromUrl(url) {

        return new Promise(async (kept, broken) => {
            let filename=url.slice(url.lastIndexOf('/')+1);
            this.logFunction(`Flashing file:${filename}`);
            var oReq = new XMLHttpRequest();
            oReq.open("GET", url, true);
            oReq.responseType = "arraybuffer";

            oReq.onload = async (oEvent) => {
                var arrayBuffer = oReq.response; // Note: not oReq.responseText
                if (arrayBuffer) {
                    var byteArray = new Uint8Array(arrayBuffer);
                    let temp = url.slice(url.lastIndexOf('_') + 1);
                    let addressText = temp.slice(0, temp.indexOf('.'));
                    let loadAddress = parseInt(addressText);
                    let { worked, message } = await device.flashImage(byteArray, loadAddress);
                    console.log(message);
                    if (!worked) {
                        broken(new Error(message));
                    }
                    kept("Worked OK");
                }
            };

            oReq.send(null);
        });
    }
}

