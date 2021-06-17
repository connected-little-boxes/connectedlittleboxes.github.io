class ESPManager {

    constructor(logFunction) {
        this.ESPtool = null;
        this.logFunction = logFunction;
        this.logFunction("Starting");
        this.serialManager = new SerialManager();
        this.connected = false;
    }
    
    async connect(){
        // Prompt user to select any serial port.

        let {worked, message} = await this.serialManager.connectToSerialPort(this.logFunction);

        if(worked){
            this.connected = true;
            this.logFunction("Port opened");
        }
        else {
            return {worked:false,message:message };
        } 
        return {worked:true, message:"Connected to a serial port"};
    }

    async flashDevice() {

        this.ESPtool = new ESPToolJS(this.serialManager, this.logFunction);

        let espClass = await this.ESPtool.detectChip();

        if(espClass==null){
            return{worked:false, message:"Chip not recognised"};
        }

        this.esp = new espClass(this.serialManager, this.logFunction);

        let description = await this.esp.get_chip_description();

        this.logFunction(description);

        let features = await this.esp.get_chip_features();

        this.logFunction(features);

        // now need to upload the stub

        let result = await this.esp.runStub();

        if(!result.worked){
            return result;
        }

        this.logFunction(`Starting the flash`);

        result = await this.esp.flashImages(); // runs the method in the child class that has the correct list of images

        if(!result.worked){
            return result;
        }
        
        await this.serialManager.delay(500);

        this.logFunction(`Resetting the device`);

        await this.serialManager.hardReset();

        this.logFunction('Closing the serial connection');

        await this. serialManager.closeSerialPort();

        return { worked: true, message: "Flash completed OK" };
    }

    async flashImage(image, address)
    {
        let result = await this.esp.flashImage(image,address);
        return result;
    }

    async startTerminal(messageReceived){
        await this.serialManager.startTerminal(messageReceived);
    }

    async writeUint8ToTerminal(val) {
        let valArray = new Uint8Array([val]);
        this.serialManager.writeUint8Array(valArray);
    }
}
