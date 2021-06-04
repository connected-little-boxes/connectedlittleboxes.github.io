class ESP32ROM extends ESPToolJS {
    //Access class for ESP32 ROM bootloader

    static CHIP_NAME = "ESP32";
    static IMAGE_CHIP_ID = 0;
    static IS_STUB = false;

    static CHIP_DETECT_MAGIC_VALUE = 0x00f01d83;

    static IROM_MAP_START = 0x400d0000;
    static IROM_MAP_END = 0x40400000;

    static DROM_MAP_START = 0x3F400000;
    static DROM_MAP_END = 0x3F800000;

    // ESP32 uses a 4 byte status reply
    static STATUS_BYTES_LENGTH = 4;

    static SPI_REG_BASE = 0x3ff42000;
    static SPI_USR_OFFS = 0x1c;
    static SPI_USR1_OFFS = 0x20;
    static SPI_USR2_OFFS = 0x24;
    static SPI_MOSI_DLEN_OFFS = 0x28;
    static SPI_MISO_DLEN_OFFS = 0x2c;
    static EFUSE_RD_REG_BASE = 0x3ff5a000;

    static EFUSE_DIS_DOWNLOAD_MANUAL_ENCRYPT_REG = ESP32ROM.EFUSE_RD_REG_BASE + 0x18;
    static EFUSE_DIS_DOWNLOAD_MANUAL_ENCRYPT = (1 << 7)  // EFUSE_RD_DISABLE_DL_ENCRYPT

    static DR_REG_SYSCON_BASE = 0x3ff66000;

    static SPI_W0_OFFS = 0x80;

    static UART_CLKDIV_REG = 0x3ff40014;

    static XTAL_CLK_DIVIDER = 1;

    static FLASH_SIZES = {
        '1MB': 0x00,
        '2MB': 0x10,
        '4MB': 0x20,
        '8MB': 0x30,
        '16MB': 0x40
    };

    static BOOTLOADER_FLASH_OFFSET = 0x1000;

    static OVERRIDE_VDDSDIO_CHOICES = ["1.8V", "1.9V", "OFF"]

    static MEMORY_MAP = [[0x00000000, 0x00010000, "PADDING"],
    [0x3F400000, 0x3F800000, "DROM"],
    [0x3F800000, 0x3FC00000, "EXTRAM_DATA"],
    [0x3FF80000, 0x3FF82000, "RTC_DRAM"],
    [0x3FF90000, 0x40000000, "BYTE_ACCESSIBLE"],
    [0x3FFAE000, 0x40000000, "DRAM"],
    [0x3FFE0000, 0x3FFFFFFC, "DIRAM_DRAM"],
    [0x40000000, 0x40070000, "IROM"],
    [0x40070000, 0x40078000, "CACHE_PRO"],
    [0x40078000, 0x40080000, "CACHE_APP"],
    [0x40080000, 0x400A0000, "IRAM"],
    [0x400A0000, 0x400BFFFC, "DIRAM_IRAM"],
    [0x400C0000, 0x400C2000, "RTC_IRAM"],
    [0x400D0000, 0x40400000, "IROM"],
    [0x50000000, 0x50002000, "RTC_DATA"]]

    static FLASH_ENCRYPTED_WRITE_ALIGN = 32;

    constructor(serialManager, logFunction) {
        super(serialManager, logFunction);
        this.logFunction("Starting ESP32");
        this.stub=esp32rom_stub;
    }

    // Try to read the BLOCK1 (encryption key) and check if it is valid """

    async is_flash_encryption_key_valid() {

        // Bit 0 of efuse_rd_disable[3:0] is mapped to BLOCK1
        // this bit is at position 16 in EFUSE_BLK0_RDATA0_REG

        let word0 = await this.read_efuse(0);
        let rd_disable = (word0 >> 16) & 0x1;

        // reading of BLOCK1 is NOT ALLOWED so we assume valid key is programmed

        if (rd_disable) {
            return true;
        } else {
            // reading of BLOCK1 is ALLOWED so we will read and verify for non-zero.
            // When ESP32 has not generated AES/encryption key in BLOCK1, the contents will be readable and 0.
            // If the flash encryption is enabled it is expected to have a valid non-zero key. We break out on
            // first occurance of non-zero value
            let key_word = [0] * 7;
            for (let i = 0; i < key_word.length; i++) {
                key_word[i] = await this.read_efuse(14 + i);
                // key is non-zero so break & return
                if (key_word[i] != 0) {
                    return true;
                }
            }
            return false;
        }
    }

    async get_flash_crypt_config() {
        // For flash encryption related commands we need to make sure
        // user has programmed all the relevant efuse correctly so before
        // writing encrypted write_flash_encrypt esptool will verify the values
        // of flash_crypt_config to be non zero if they are not read
        // protected. If the values are zero a warning will be printed

        // bit 3 in efuse_rd_disable[3:0] is mapped to flash_crypt_config
        // this bit is at position 19 in EFUSE_BLK0_RDATA0_REG

        let word0 = await this.read_efuse(0);
        let rd_disable = (word0 >> 19) & 0x1;

        if (rd_disable == 0) {
            // we can read the flash_crypt_config efuse value
            // so go & read it (EFUSE_BLK0_RDATA5_REG[31:28])
            let word5 = this.read_efuse(5);
            word5 = (word5 >> 28) & 0xF;
            return word5;
        } else {
            // if read of the efuse is disabled we assume it is set correctly
            return 0xF;
        }
    }

    async get_encrypted_download_disabled() {
        if (await this.readReg(ESP32ROM.EFUSE_DIS_DOWNLOAD_MANUAL_ENCRYPT_REG) & ESP32ROM.EFUSE_DIS_DOWNLOAD_MANUAL_ENCRYPT) {
            return true;
        } else {
            return false;
        }
    }

    async get_pkg_version() {
        let word3 = await this.read_efuse(3);
        let pkg_version = (word3 >> 9) & 0x07;
        pkg_version += ((word3 >> 2) & 0x1) << 3;
        return pkg_version;
    }

    async get_chip_revision() {
        let word3 = await this.read_efuse(3);
        let word5 = await this.read_efuse(5);
        let apb_ctl_date = await this.readReg(ESP32ROM.DR_REG_SYSCON_BASE + 0x7C);

        let rev_bit0 = (word3 >> 15) & 0x1;
        let rev_bit1 = (word5 >> 20) & 0x1;
        let rev_bit2 = (apb_ctl_date >> 31) & 0x1;

        if (rev_bit0)
            if (rev_bit1)
                if (rev_bit2)
                    return 3;
                else
                    return 2;
            else
                return 1;
        return 0;
    }

    async get_chip_description() {
        let pkg_version = await this.get_pkg_version();
        let chip_revision = await this.get_chip_revision();
        let rev3 = (chip_revision == 3);
        let single_core = await this.read_efuse(3) & (1 << 0);  // CHIP_VER DIS_APP_CPU

        let chip_name;

        switch (pkg_version) {
            case 0: if (single_core) { chip_name = "ESP32-S0WDQ6"; } else { chip_name = "ESP32-D0WDQ6"; };
                break;
            case 1: if (single_core) { chip_name = "ESP32-S0WD"; } else { chip_name = "ESP32-D0WD"; };
                break;
            case 2: chip_name = "ESP32-D2WD";
                break;
            case 4: chip_name = "ESP32-U4WDH";
                break;
            case 5: if (rev3) { chip_name = "ESP32-PICO-V3" } else { chip_name = "ESP32-PICO-D4" };
                break;
            case 6: chip_name = "ESP32-PICO-V3-02";
                break;
            default:
                chip_name = "unknown ESP32";
        }

        // ESP32-D0WD-V3, ESP32-D0WDQ6-V3

        if (chip_name.startsWith("ESP32-D0WD") && rev3) {
            chip_name += "-V3";
        }

        return `${chip_name} (revision ${chip_revision})`;
    }

    async get_chip_features() {
        let features = ["WiFi"];

        let word3 = await this.read_efuse(3)

        // names of variables in this section are lowercase
        // versions of EFUSE names as documented in TRM and
        // ESP-IDF efuse_reg.h

        let chip_ver_dis_bt = word3 & (1 << 1);

        if (chip_ver_dis_bt == 0) {
            features += ["BT"]
        }

        let chip_ver_dis_app_cpu = word3 & (1 << 0);

        if (chip_ver_dis_app_cpu) {
            features += ["Single Core"];
        } else {
            features += ["Dual Core"];
        }

        return features;
    }

    async read_efuse(n) {
        // Read the nth word of the ESP3x EFUSE region. 
        return await this.readReg(ESP32ROM.EFUSE_RD_REG_BASE + (4 * n));
    }

    chip_id() {
        throw "chip_id not supported";
    }

    async read_mac() {
        // Read MAC from EFUSE region """
        let view = new DataView(new ArrayBuffer(8));
        view.setInt32(0, await this.read_efuse(2), true);
        let bitString = view.buffer.slice(2); // trim the 2 byte CRC
        return bitString;
    }

    get_erase_size(offset, size) {
        return size;
    }

    override_vddsdio(new_voltage) {
        throw "override_vddsdio not supported";
    }

    async read_flash_slow(offset, length, progress_fn) {
        let BLOCK_LEN = 64  // ROM read limit per command (this limit is why it's so slow)

        let result = new DataView(new ArrayBuffer(length));
        let pos = 0;

        while (pos < length) {
            let blockLength = Math.min(BLOCK_LEN, length - pos);
        }
    }

    async flashImages()
    {
        let imageUrls = [
            'esptool/firmware/esp32/bootloader_dio_40m_0x1000.bin',
            'esptool/firmware/esp32/partitions_0x8000.bin',
            'esptool/firmware/esp32/boot_app0_0xe000.bin',
            'esptool/firmware/esp32/firmware_0x10000.bin'
        ];

        for(let url of imageUrls){
            let result = await this.flashFromUrl(url);
        }

        return { worked: true, message: `Images flashed` };
    }
}

