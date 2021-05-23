class ESP8266ROM extends ESPToolJS {
    // Access class for ESP8266 ROM bootloader
    static CHIP_NAME = "ESP8266";
    static ESP_READ_REG = false;
    static ESP_READ_REG = false;

    static CHIP_DETECT_MAGIC_VALUE = 0xfff0c101;

    // OTP ROM addresses
    static ESP_OTP_MAC0 = 0x3ff00050;
    static ESP_OTP_MAC1 = 0x3ff00054;
    static ESP_OTP_MAC3 = 0x3ff0005c;

    static SPI_REG_BASE = 0x60000200;
    static SPI_USR_OFFS = 0x1c;
    static SPI_USR1_OFFS = 0x20;
    static SPI_USR2_OFFS = 0x24;
    static SPI_MOSI_DLEN_OFFS = null;
    static SPI_MISO_DLEN_OFFS = null;
    static SPI_W0_OFFS = 0x40;

    static UART_CLKDIV_REG = 0x60000014;

    static XTAL_CLK_DIVIDER = 2;

    static FLASH_SIZES = {
        '512KB': 0x00,
        '256KB': 0x10,
        '1MB': 0x20,
        '2MB': 0x30,
        '4MB': 0x40,
        '2MB-c1': 0x50,
        '4MB-c1': 0x60,
        '8MB': 0x80,
        '16MB': 0x90,
    }

    static BOOTLOADER_FLASH_OFFSET = 0;

    static MEMORY_MAP = [[0x3FF00000, 0x3FF00010, "DPORT"],
    [0x3FFE8000, 0x40000000, "DRAM"],
    [0x40100000, 0x40108000, "IRAM"],
    [0x40201010, 0x402E1010, "IROM"]];

    constructor(serialManager, logFunction) {
        super(serialManager, logFunction);
        this.stub = esp8266_stub;
    }

    async get_efuses() {
        // Return the 128 bits of ESP8266 efuse as a single Python integer
        let result = await this.readReg(0x3ff0005c) << 96;
        result |= await this.readReg(0x3ff00058) << 64;
        result |= await this.readReg(0x3ff00054) << 32;
        result |= await this.readReg(0x3ff00050);
        return result;
    }

    async get_chip_description() {
        let efuses = await this.get_efuses();
        let is_8285 = (efuses & ((1 << 4) | 1 << 80)) != 0; // # One or the other efuse bit is set for ESP8285
        if (is_8285) {
            return "ESP8285";
        }
        else {
            return "ESP8266EX";
        }
    }

    async get_chip_features() {
        let features = ["WiFi"];
        if (await this.get_chip_description() == "ESP8285") {
            features += [" Embedded Flash"];
        }
        return features;
    }

    flash_spi_attach(hspi_arg) {
        if (ESP8266ROM.IS_STUB) {
            super.flash_spi_attach(hspi_arg);
        }
        else {
            // ESP8266 ROM has no flash_spi_attach command in serial protocol,
            // but flash_begin will do it
            this.flash_begin(0, 0);
        }
    }

    flash_set_parameters(size) {
        //not implemented in ROM, but OK to silently skip for ROM
        if (ESP8266ROM.IS_STUB) {
            super.flash_set_parameters(size);
        }
    }

    chip_id() {
        // Read Chip ID from efuse - the equivalent of the SDK system_get_chip_id() function """
        let id0 = this.readReg(ESP8266ROM.ESP_OTP_MAC0);
        let id1 = this.readReg(ESP8266ROM.ESP_OTP_MAC1);
        return (id0 >> 24) | ((id1 & MAX_UINT24) << 8);
    }

    read_mac() {
        //  Read MAC from OTP ROM """
        let mac0 = this.readReg(ESP8266ROM.ESP_OTP_MAC0);
        let mac1 = this.readReg(ESP8266ROM.ESP_OTP_MAC1);
        let mac3 = this.readReg(ESP8266ROM.ESP_OTP_MAC3);
        if (mac3 != 0) {
            oui = ((mac3 >> 16) & 0xff, (mac3 >> 8) & 0xff, mac3 & 0xff)
        }
        else if (((mac1 >> 16) & 0xff) == 0) {
            oui = (0x18, 0xfe, 0x34);
        } else if (((mac1 >> 16) & 0xff) == 1) {
            oui = (0xac, 0xd0, 0x74);
        } else {
            throw ("Unknown OUI");
        }
        return oui + ((mac1 >> 8) & 0xff, mac1 & 0xff, (mac0 >> 24) & 0xff);
    }


    get_erase_size(offset, size) {
        // Calculate an erase size given a specific size in bytes.
        // Provides a workaround for the bootloader erase bug."""

        let sectors_per_block = 16;
        let sector_size = ESP8266ROM.FLASH_SECTOR_SIZE;

        let num_sectors = (size + sector_size - 1); // sector_size
        let start_sector = offset; // sector_size

        let head_sectors = sectors_per_block - (start_sector % sectors_per_block);

        if (num_sectors < head_sectors) {
            head_sectors = num_sectors;
        }

        if (num_sectors < 2 * head_sectors) {
            return Math.trunc((num_sectors + 1) / 2 * sector_size);
        }
        else {
            return (num_sectors - head_sectors) * sector_size;
        }
    }

    async flashImages()
    {
        let imageUrls = ['esptool/firmware/esp8266/firmware_0x0000.bin'];

        for(let url of imageUrls){
            await this.flashFromUrl(url);
        }
        return { worked: true, message: `Images flashed` };
    }

    override_vddsdio(new_voltage) {
        throw ("Overriding VDDSDIO setting only applies to ESP32");
    }
}    

class ESP8266StubLoader extends ESP8266ROM {
    // Access class for ESP8266 stub loader, runs on top of ROM.

    static FLASH_WRITE_SIZE = 0x4000;  // matches MAX_WRITE_BLOCK in stub_loader.c
    static IS_STUB = true;

    constructor(port, slipStream, logFunction) {
        super(port, slipStream, logFunction);
    }

    get_erase_size(offset, size) {
        return size;  // stub doesn't have same size bug as ROM loader
    }
}
