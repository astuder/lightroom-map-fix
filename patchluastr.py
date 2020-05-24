# Copyright (c) 2018-2020 Adrian Studer
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

import sys
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

class LuaFile():
    def __init__(self, file):
        self.file = file
        self.header = bytearray()

    def load(self):
        # read and verify Lua signature: 4 bytes (0x1b, 0x4c, 0x75, 0x61) (ESC Lua)
        print("Processing", self.file.name)
        self.sig = self.file.read(4)
        if self.sig != b'\x1bLua':
            print("This is not a Lua file.")
            exit()
        self.header.extend(self.sig)

        # read and verify version: 2 bytes (0x52, 0x00)
        self.ver = self.file.read(2)
        print("Lua %d.%d detected" % (self.ver[0] >> 4, self.ver[0] & 0x0f))
        if self.ver[1] != 0:
            print("Error: Lua file not compatible with PUC-Rio")
            exit()
        self.header.extend(self.ver)

        # read Lua system parameters: 6 bytes (endianess, int size, size_t size,
        # instruction size, num size, float)
        lua_sys_par = self.file.read(6)
        self.endian = lua_sys_par[0]
        self.int_size = lua_sys_par[1]
        self.sizet_size = lua_sys_par[2]
        self.instr_size = lua_sys_par[3]
        self.num_size = lua_sys_par[4]
        print("Lua settings: endian %d, int %d, size_t %d, instruction %d, number %d" %
            (self.endian, self.int_size, self.sizet_size, self.instr_size, self.num_size))
        if self.endian != 1:
            print("Error: Lua file is big endian. Sorry, not supported yet :-(")
            exit()
        self.header.extend(lua_sys_par)

        # read rest of file
        self.body = self.file.read()
        print("%d bytes read from file" % (len(self.header) + len(self.body)))

    def replace(self, find, replace):
        # search and replace strings
        pos_start = 0
        replace_count = 0
        new_body = bytearray()
        while True:
            pos = self.body.find(find.encode('utf-8'), pos_start)
            if pos == -1:
                break
            print("Found '%s' at %d" % (find, pos_start + pos))
            # find start of Lua string (has to be fancier to work for big endian)
            str_start = pos
            while self.body[str_start] != 0:
                str_start -= 1
            # find end of Lua string
            str_end = pos
            while self.body[str_end] != 0:
                str_end += 1
            str_original = self.body[str_start + 1:str_end].decode("utf-8")
            # verify Lua string
            if self.body[str_start - self.sizet_size] != 4:
                print("Error: Failed to parse Lua string structure")
                exit()
            str_len = decode_int(self.body[str_start - self.sizet_size + 1:str_start + 1], self.endian)
            if str_len != len(str_original) + 1:
                print("Error: Failed to parse Lua string structure")
                exit()
            # copy data before Lua string
            new_body.extend(self.body[pos_start:str_start - self.sizet_size])
            # write new Lua string
            str_new = str_original.replace(find, replace).encode("utf-8")
            new_body.extend([4])
            new_body.extend(encode_int(len(str_new) + 1, self.sizet_size, self.endian))
            new_body.extend(str_new)
            new_body.extend([0])
            # continue search
            replace_count += 1
            pos_start = str_end + 1
        
        if replace_count == 0:
            print("'%s' not found, nothing to patch" % (find))
        else:
            print("Updated %d strings" % (replace_count))

        # copy remaining data
        new_body.extend(self.body[pos_start:])

        # replace body with processed version
        self.body = new_body;

    def write_to(self, file):
        # write Lua header and body to a new file
        file.write(self.header)
        file.write(self.body)
        print("%d bytes written to %s" % (len(self.header)+len(self.body), file.name))

class Section:
    def __init__(self):
        self.name = ""
        self.infile = ""
        self.outfile = ""
        self.patches = []

class Patch:
    def __init__(self):
        self.find = ""
        self.replace = ""

class PatchFile:
    def __init__(self, file):
        errors = 0
        self.sections = []
        currsection = None
        currpatch = None
        for lnr, line in enumerate(file):
            line = line.lstrip()
            if len(line) == 0:
                # ignore empty lines
                pass
            elif line.startswith("#"):
                # ignore comment lines
                pass
            elif line.startswith("[") and line.rstrip().endswith("]"):
                # new section
                currsection = Section()
                currpatch = None
                self.sections.append(currsection)
                currsection.name = line.rstrip()[1:-1]            
            elif line.startswith("< "):
                # find string
                if currsection is None:
                    print("Error: No current section in line", lnr)
                    print(line.rstrip())
                    errors += 1
                elif len(line[2:-1]) == 0:
                    print("Error: Missing search string in line", lnr)
                    print(line.rstrip())
                    errors += 1
                else:
                    currpatch = Patch()
                    currsection.patches.append(currpatch)
                    currpatch.find = line[2:-1]
            elif line.startswith(">"):
                # replace string
                if currsection is None:
                    print("Error: No current section in line", lnr)
                    print(line.rstrip())
                    errors += 1
                elif currpatch is None:
                    print("Error: Missing search string before line", lnr)
                    print(line.rstrip())
                    errors += 1
                elif len(line.rstrip()) > 2 and not line.startswith("> "):
                    print("Error: Missing space after > in line", lnr)
                    print(line.rstrip())
                    errors += 1
                else:
                    if len(currpatch.replace) != 0:
                        currpatch.replace += "\n"
                    currpatch.replace += line[2:-1]
            else:
                try:
                    name, value = line.split("=", 1)
                    name = name.rstrip()
                    value = value.lstrip().rstrip()
                    if currsection is None:
                        print("Error: No current section in line", lnr)
                        print(line.rstrip())
                        errors += 1
                    elif name == "in":
                        # input file
                        if currsection.infile == "":
                            currsection.infile = value
                        else:
                            print("Error: More than 1 input file per section in line", lnr)
                            print(line.rstrip())
                            errors += 1
                    elif name == "out":
                        # input file
                        if currsection.outfile == "":
                            currsection.outfile = value
                        else:
                            print("Error: More than 1 output file per section in line", lnr)
                            print(line.rstrip())
                            errors += 1
                    else:
                        # unknown option
                        print("Error: Unknown option in line", lnr)
                        print(line.rstrip())
                        errors += 1
                except ValueError:
                    print("Error: Failed to parse line",lnr)
                    print(line.rstrip())
                    errors += 1
        
        # validate in/out files
        for s in self.sections:
            if s.infile == "":
                print("Error: Missing input file for section", s.name)
                print(line.rstrip())
                errors += 1
            elif s.outfile == "":
                s.outfile = s.infile + ".patched"

        if errors > 0:
            print("Aborting due to errors in patch script. No files were patched.")
            exit()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        epilog="If a patch file is used, all other arguments are ignored. Without patch file, all positional arguments are mandatory.")
    parser.add_argument("input", type=argparse.FileType("rb", 0), nargs="?",
                        help="input file")
    parser.add_argument("find", type=str, nargs="?",
                        help="string to find")
    parser.add_argument("replace", type=str, nargs="?",
                        help="string to use as replacement")
    parser.add_argument("-o", "--output", type=argparse.FileType("wb", 0),
                        help="output file")
    parser.add_argument("-p", "--patch", type=argparse.FileType("r"),
                        help="file with patch instructions")
    args = parser.parse_args()

    # check if any arguments were passed
    if not len(sys.argv) > 1:
        parser.print_usage()
        exit()

    # using input, find, replace arguments
    if args.patch is None:
        if args.input is None or args.find is None or args.replace is None:
            print("Either a patch file, or an input file plus find and replace strings are required")
            exit()

        file = LuaFile(args.input)
        file.load()
        file.replace(args.find, args.replace)

        # write new file
        if args.output is None:
            args.output = open(args.input.name + ".patched", "wb")
        file.write_to(args.output)
        
        # clean up
        args.output.close()
        args.input.close()
    else:
        # using patch file
        patch = PatchFile(args.patch)
        for s in patch.sections:
            print("Processing section [{}]".format(s.name))
            with open(s.infile, "rb", 0) as infile:
                with open(s.outfile, "wb", 0) as outfile:
                    file = LuaFile(infile)
                    file.load()
                    for p in s.patches:
                        file.replace(p.find, p.replace)
                    file.write_to(outfile)

        # clean up
        args.patch.close()

    # done
    exit()


