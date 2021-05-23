var port = null;
var textDecoder = null;
var reader = null;
var readableStreamClosed = null;

async function doConnect()
{
   // Prompt user to select any serial port.
   port = await navigator.serial.requestPort();
   await port.open({ baudRate:115200});

   textDecoder = new TextDecoderStream();
   readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
   reader = textDecoder.readable.getReader();

   // Listen to data coming from the serial device.
   while (true) {
     const { value, done } = await reader.read();
     if (done) {
       // Allow the serial port to be closed later.
       reader.releaseLock();
       break;
     }
     document.getElementById("terminal").value += value;
     console.log(value);
   }

}

async function doDoDisconnect()
{

}


async function doDoReset()
{
  if(port==null)
  {
    alert("Not connected to device");
    return;
  }

  await port.setSignals({ dataTerminalReady: true });
  await port.setSignals({ requestToSend: false });

  setTimeout( async ()=>{
    await port.setSignals({ dataTerminalReady: false });
    await port.setSignals({ requestToSend: true });
    setTimeout( async ()=> {
      await port.setSignals({ dataTerminalReady: true });

    },100);
  },100);
}


async function doKeypress()
{
    console.log("click");
}