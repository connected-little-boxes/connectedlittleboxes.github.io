class SlipTransformer {

    constructor() {
        console.log("Creating a new slip transformer");
        this._partialPacket = null;
        this._inEscape = false;
    }

    transform(chunk, controller) {
        for (let b of chunk) {
            if (this._partialPacket == null) {
                // Start of a packet
                if (b == 0xc0) {
                    this._partialPacket = [];
                }
            }
            else {
                // Adding bytes to a packet
                if (this._inEscape) {
                    // part-way through escape sequence
                    this.in_escape = false;

                    if (b == 0xdc) {
                        this._partialPacket.push(0xc0);
                    }
                    else if (b == 0xdd) {
                        this._partialPacket.push(0xdb);
                    }
                    else {
                        this._partialPacket = null;
                    }
                }
                else {
                    // not in escape sequence
                    if (b == 0xdb) {
                        // start of escape sequence
                        this._inEscape = true;
                    }
                    else if (b == 0xc0) {
                        // marks the end of a message
                        // If we get out of step with 0xC0 markers we 
                        // will get two 0xC0 values in succession 
                        // (one marks the end of one packet and the other 
                        // the start of the next one. )
                        // If this is the case the partial packet will 
                        // be empty. Only send non-empty packets
                        if (this._partialPacket.length > 0) {
                            controller.enqueue(this._partialPacket);
                            this._partialPacket = null;
                        }
                    }
                    else {
                        this._partialPacket.push(b);
                    }
                }
            }
        }
    }
    flush(controller) {
        // When the stream is closed, flush any remaining chunks out.
        controller.enqueue(this.chunks);
    }
}