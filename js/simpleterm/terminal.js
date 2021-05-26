class Terminal {

    constructor() {
        this.port = null;
        this.reader = null;
        this.handleIncomingText = null;
    }

    async connectToSerialPort() {

        if (!"serial" in navigator) {
            this.port = null;
            return "This browser doesn't support serial connection. Try Edge or Chrome.";
        }

        try {
            this.port = await navigator.serial.requestPort();
            await this.port.open({ baudRate: 115200, bufferSize: 10000 });
        }
        catch (error) {
            return "Serial port open failed:" + error.message;
        }

        return "";
    }

    async writeUint8Array(valArray) {
        const writer = this.port.writable.getWriter();
        await writer.write(valArray);
        writer.releaseLock();
    }

    async sendText(text) {
        let bytes = new TextEncoder("utf-8").encode(text);
        await this.writeUint8Array(bytes);
    }

    handleIncomingBytes(bytes) {
        var text = new TextDecoder("utf-8").decode(bytes);
        this.handleIncomingText(text);
        return;
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
                    this.handleIncomingBytes(value);
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

    async disconnect() {
        if (this.port == null || this.keepReading==false) {
            return;
        }
        this.keepReading = false;

        if (this.reader != null) {
            this.reader.cancel();
        }
    }

    async startSerialPump(destination) {
        this.keepReading = true;
        this.handleIncomingText = destination;
        await this.pumpReceivedCharacters();
        return "Serial disconnected";
    }
}

