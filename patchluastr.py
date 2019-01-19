# Copyright (c) 2018 Adrian Studer
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.

import argparse

def decode_int(data, endian):
    num = 0
    if endian == 0:
        for b in data:
            num = (num << 8) | b
    else:
        for b in reversed(data):
            num = (num << 8) | b
    return num

def encode_int(num, size, endian):
    out = bytearray(size)
    for pos in range(size):
        out[pos] = num & 0xff
        num = num >> 8
    if endian == 0:
        out = reversed(out)
    return out

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=argparse.FileType("rb", 0),
                        help="input file")
    parser.add_argument("find", type=str,
                        help="string to find")
    parser.add_argument("replace", type=str,
                        help="string to use as replacement")
    parser.add_argument("-o", "--output", type=argparse.FileType("wb", 0),
                        help="output file")
    parser.add_argument("-s", "--substr", action="store_true",
                        help="also replace substrings")
    args = parser.parse_args()

    # prepare data for new file
    data_dst = bytearray()

    # read and verify LUA signature: 4 bytes (0x1b, 0x4c, 0x75, 0x61) (ESC Lua)
    print("Processing", args.input.name)
    lua_sig = args.input.read(4)
    if lua_sig != b'\x1bLua':
        print("This is not a Lua file.")
        exit()
    data_dst.extend(lua_sig)

    # read and verify version: 2 bytes (0x52, 0x00)
    lua_ver = args.input.read(2)
    print("Lua %d.%d detected" % (lua_ver[0] >> 4, lua_ver[0] & 0x0f))
    if lua_ver[1] != 0:
        print("Error: Lua file not compatible with PUC-Rio")
        exit()
    data_dst.extend(lua_ver)

    # read system parameters: 6 bytes (endianess, int size, size_t size, instruction size,
    # lua num size, float)
    lua_sys_par = args.input.read(6)
    lua_endian = lua_sys_par[0]
    lua_int_size = lua_sys_par[1]
    lua_sizet_size = lua_sys_par[2]
    lua_instr_size = lua_sys_par[3]
    lua_num_size = lua_sys_par[4]
    print("Lua settings: endian %d, int %d, size_t %d, instruction %d, number %d" %
        (lua_endian, lua_int_size, lua_sizet_size, lua_instr_size, lua_num_size))
    if lua_endian != 1:
        print("Error: Lua file is big endian. Sorry, not supported yet :-(")
        exit()
    data_dst.extend(lua_sys_par)

    # read rest of file
    data_src = args.input.read()
    print("%d bytes read from file" % (len(data_src) + len(data_dst)))

    # search and replace strings
    pos_start = 0
    replace_count = 0
    while True:
        pos = data_src.find(args.find.encode('utf-8'), pos_start)
        if pos == -1:
            break
        print("Found '%s' at %d" % (args.find, pos_start + pos))
        # find start of Lua string (has to be fancier to work for big endian)
        str_start = pos
        while data_src[str_start] != 0:
            str_start -= 1
        # find end of Lua string
        str_end = pos
        while data_src[str_end] != 0:
            str_end += 1
        str_original = data_src[str_start + 1:str_end].decode("utf-8")
          # verify Lua string
        if data_src[str_start - lua_sizet_size] != 4:
            print("Error: Failed to parse Lua string structure")
            exit()
        str_len = decode_int(data_src[str_start - lua_sizet_size + 1:str_start + 1], lua_endian)
        if str_len != len(str_original) + 1:
            print("Error: Failed to parse Lua string structure")
            exit()
        # copy data before Lua string
        data_dst.extend(data_src[pos_start:str_start - lua_sizet_size])
        # write new Lua string
        str_new = str_original.replace(args.find, args.replace).encode("utf-8")
        data_dst.extend([4])
        data_dst.extend(encode_int(len(str_new) + 1, lua_sizet_size, lua_endian))
        data_dst.extend(str_new)
        data_dst.extend([0])
        # continue search
        replace_count += 1
        pos_start = str_end + 1
    
    if replace_count == 0:
        print("'%s' not found, nothing to patch" % (args.find))
        exit()
    else:
        print("Updated %d strings" % (replace_count))

    # copy remaining data
    data_dst.extend(data_src[pos_start:])

    # write new file
    if args.output is None:
        args.output = open(args.input.name + ".patched", "wb")
    args.output.write(data_dst)
    print("%d bytes written to %s" % (len(data_dst), args.output.name))
    args.output.close()
    args.input.close()
